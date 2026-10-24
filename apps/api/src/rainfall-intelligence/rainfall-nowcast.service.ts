import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  RainfallGrid,
  RainfallModelRun,
  RainfallNowcastRun,
  WeatherHourlySample,
} from '../database/entities';
import { GRID_PRODUCT } from './gsmap-ingestion.service';
import { rainGridToBase64 } from './lib/rain-grid-codec';
import {
  loadRainGrids,
  loadWindHistory,
  windAt,
  type DecodedRainGrid,
  type WindHour,
} from './rain-inputs.store';
import {
  RainfallEngineClient,
  type RainNowcastRequest,
} from './rainfall-engine.client';
import {
  DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
  GSMAP_ATTRIBUTION,
} from './rainfall.constants';
import { loadPromotedSpatialModel } from './spatial-model.store';
import { getDistrictPoints, type DistrictPoint } from './weather-samples.store';

const HOUR_MS = 60 * 60 * 1000;
export const NOWCAST_HORIZONS_HOURS = [1, 2, 3];
// GSMaP_NOW has ~0 h latency and is ingested hourly, so the newest field is
// normally < 70 min old. Past 2 h at least one ingestion was missed and a
// 1-3 h nowcast would start from conditions that are already history:
// refuse rather than issue it.
export const MAX_RAIN_FIELD_AGE_MS = 2 * HOUR_MS;
export const STEERING_LEVEL = '700hPa';

export const NOWCAST_DISCLAIMER =
  'Experimental Stage-1 baseline. Probabilities are uncalibrated neighbourhood fractions from a satellite rainfall estimate (JAXA GSMaP_Gauge_NOW, ~11 km, hourly); not a BMKG forecast. Check the backtest before relying on any method.';

/** Model winds are stored every RAINFALL_INGESTION_INTERVAL_MS (+1 h slack). */
export function maxSteeringWindAgeMs(config: ConfigService): number {
  const configured = Number(
    config.get('RAINFALL_INGESTION_INTERVAL_MS') ??
      DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
  );
  return (
    (configured > 0 ? configured : DEFAULT_RAINFALL_INGESTION_INTERVAL_MS) +
    HOUR_MS
  );
}

/** Engine payload for one start time. Pure. */
export function buildNowcastRequest(args: {
  issuedAt: Date;
  current: DecodedRainGrid;
  previous: DecodedRainGrid | null;
  districts: DistrictPoint[];
  winds: Map<string, WindHour[]>;
  maxWindAgeMs: number;
  horizonsHours?: number[];
}): RainNowcastRequest {
  return {
    issuedAt: args.issuedAt.toISOString(),
    grid: args.current.domain,
    current: {
      validTime: args.current.validTime.toISOString(),
      dataB64: rainGridToBase64(args.current.values),
    },
    ...(args.previous
      ? {
          previous: {
            validTime: args.previous.validTime.toISOString(),
            dataB64: rainGridToBase64(args.previous.values),
          },
        }
      : {}),
    points: args.districts.map((district) => {
      const hour = windAt(
        args.winds.get(district.id),
        args.current.validTime,
        args.maxWindAgeMs,
      );
      const steering = hour?.[STEERING_LEVEL];
      return {
        id: district.id,
        latitude: district.latitude,
        longitude: district.longitude,
        ...(steering && hour
          ? {
              steeringWind: {
                level: STEERING_LEVEL,
                speedKmh: steering.speedKmh,
                fromDeg: steering.fromDeg,
                validTime: hour.validTime.toISOString(),
              },
            }
          : {}),
      };
    }),
    horizonsHours: args.horizonsHours ?? NOWCAST_HORIZONS_HOURS,
  };
}

/**
 * Milestone 2: issues Stage-1 rain nowcasts (persistence, tracked-motion
 * advection, steering-wind advection) for every kabupaten/kota point from
 * the two newest stored GSMaP fields, via ai-engine `/predict-rain-nowcast`.
 * Every run — including refused and failed ones — is persisted with its
 * inputs' provenance (docs/RAINFALL_INTELLIGENCE.md).
 */
@Injectable()
export class RainfallNowcastService {
  private readonly logger = new Logger(RainfallNowcastService.name);
  private running = false;

  constructor(
    private readonly engine: RainfallEngineClient,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(RainfallGrid)
    private readonly gridRepository: Repository<RainfallGrid>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
    @InjectRepository(RainfallNowcastRun)
    private readonly runRepository: Repository<RainfallNowcastRun>,
    @InjectRepository(RainfallModelRun)
    private readonly modelRunRepository: Repository<RainfallModelRun>,
  ) {}

  /** Returns null if a run is already in progress in this process. */
  async run(
    trigger: 'scheduled' | 'manual',
    now: Date = new Date(),
  ): Promise<RainfallNowcastRun | null> {
    if (this.running) return null;
    this.running = true;
    const run = this.runRepository.create({
      status: 'failed',
      trigger,
      issuedAt: now,
      rainSource: GRID_PRODUCT,
      horizonsHours: NOWCAST_HORIZONS_HOURS,
      parameters: { steeringLevel: STEERING_LEVEL },
      warnings: [],
      dataValidTime: null,
      previousValidTime: null,
      modelVersions: null,
      inputSummary: null,
      results: null,
      error: null,
    });
    try {
      await this.execute(run, now);
    } catch (error) {
      run.status = 'failed';
      run.error = (error as Error).message;
      this.logger.error(`Rain nowcast failed: ${run.error}`);
    } finally {
      run.completedAt = new Date();
      this.running = false;
    }
    return this.runRepository.save(run);
  }

  private async execute(run: RainfallNowcastRun, now: Date): Promise<void> {
    const grids = await loadRainGrids(
      this.gridRepository,
      GRID_PRODUCT,
      new Date(now.getTime() - 6 * HOUR_MS),
      now,
    );
    const current = grids[grids.length - 1];
    if (!current) {
      run.status = 'insufficient_data';
      run.warnings = [
        'No stored rain field in the last 6 h (GSMaP ingestion not running?).',
      ];
      return;
    }
    run.dataValidTime = current.validTime;
    const ageMs = now.getTime() - current.validTime.getTime();
    if (ageMs > MAX_RAIN_FIELD_AGE_MS) {
      run.status = 'insufficient_data';
      run.warnings = [
        `Newest rain field is ${Math.round(ageMs / 60_000)} min old (limit ${MAX_RAIN_FIELD_AGE_MS / 60_000}); nowcast refused.`,
      ];
      return;
    }
    const previous =
      grids.find(
        (g) => g.validTime.getTime() === current.validTime.getTime() - HOUR_MS,
      ) ?? null;
    if (!previous) {
      run.warnings.push(
        'No rain field one hour before the newest: motion tracking unavailable, motion_advection not issued.',
      );
    }
    run.previousValidTime = previous?.validTime ?? null;

    const districts = await getDistrictPoints(this.districtRepository);
    const maxWindAgeMs = maxSteeringWindAgeMs(this.config);
    const winds = await loadWindHistory(
      this.sampleRepository,
      new Date(current.validTime.getTime() - maxWindAgeMs),
      current.validTime,
    );
    const request = buildNowcastRequest({
      issuedAt: now,
      current,
      previous,
      districts,
      winds,
      maxWindAgeMs,
    });
    const promoted = await loadPromotedSpatialModel(this.modelRunRepository);
    if (promoted) request.spatialModel = promoted.spec;
    const withWind = request.points.filter((p) => p.steeringWind).length;
    if (withWind < districts.length) {
      run.warnings.push(
        `${districts.length - withWind} district(s) lack a ${STEERING_LEVEL} model wind within ${maxWindAgeMs / HOUR_MS} h: steering_wind_advection not issued there.`,
      );
    }

    const response = await this.engine.predictRainNowcast(request);
    run.status = 'completed';
    run.modelVersions = response.modelVersions;
    run.parameters = {
      ...run.parameters,
      thresholdMmPerHour: response.thresholdMmPerHour,
      calibrated: response.calibrated,
    };
    run.inputSummary = {
      rainFrames: {
        source: GRID_PRODUCT,
        dataKind: 'satellite_estimate',
        current: current.validTime.toISOString(),
        previous: previous?.validTime.toISOString() ?? null,
        domain: current.domain,
        missingFraction: response.gridMissingFraction,
        attribution: GSMAP_ATTRIBUTION,
      },
      steeringWind: {
        source: 'open-meteo',
        dataKind: 'nwp_model',
        level: STEERING_LEVEL,
        districtsWithWind: withWind,
        maxAgeHours: maxWindAgeMs / HOUR_MS,
      },
      spatialModel: promoted
        ? {
            trainingRunId: promoted.runId,
            modelVersion: promoted.spec.modelVersion,
            horizonsHours: Object.keys(promoted.spec.horizons).map(Number),
            note: response.spatialModelNote,
          }
        : {
            note: 'No spatial model has passed its promotion gate; only Stage-1 baselines issued.',
          },
      districts: districts.length,
      disclaimer: NOWCAST_DISCLAIMER,
    };
    // Stage-2 features are training inputs, not results: not stored per run.
    run.results = response.points.map(
      ({ spatialFeatures: _features, ...point }) => point,
    );
  }

  async latest(districtId?: string) {
    const run = await this.runRepository.findOne({
      where: {},
      order: { issuedAt: 'DESC' },
    });
    if (!run) throw new NotFoundException('No rain nowcast has been run yet');
    if (!districtId) return run;
    const result = (run.results ?? []).find(
      (point) => (point as { id: string }).id === districtId,
    );
    if (!result) {
      throw new NotFoundException(
        `No nowcast for district ${districtId} in the latest run`,
      );
    }
    return { ...run, results: [result] };
  }
}
