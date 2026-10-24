import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  HazardEvent,
  RainfallRiskRun,
  WeatherHourlySample,
} from '../database/entities';
import { BNPB_LAYER_FLOOD_HAZARD_INDEX } from '../ingestion/adapters/bnpb-inarisk.client';
import {
  DistrictHazardIndexService,
  HAZARD_INDEX_SOURCE,
} from './district-hazard-index.service';
import {
  assignGaugesToDistricts,
  nationalTerciles,
  parseSiagaLevel,
  selectAntecedentRainfall,
  selectFloodRainfall,
  selectSoilMoisture,
  type FloodPointIn,
  type GaugeReading,
} from './lib/flood-inputs';
import { rainfallSourcePriorities } from './lib/trailing-rainfall';
import { RainfallEngineClient } from './rainfall-engine.client';
import {
  GSMAP_ATTRIBUTION,
  OPEN_METEO_ATTRIBUTION,
} from './rainfall.constants';
import {
  getDistrictPoints,
  loadRainfallSamples,
  type DistrictPoint,
} from './weather-samples.store';

const HOUR_MS = 60 * 60 * 1000;
// 168 h antecedent window + one ingestion interval of slack.
const SAMPLE_LOOKBACK_HOURS = 172;
const PETABENCANA_SOURCE = 'petabencana';
// PetaBencana is polled every 15 min and gauges report roughly hourly; an
// alert older than this describes a river that may already have receded.
export const GAUGE_MAX_AGE_MS = 3 * HOUR_MS;
// A gauge informs its nearest district point only within this distance
// (no watershed polygons exist; see assignGaugesToDistricts).
export const GAUGE_MAX_DISTANCE_KM = 30;

export const FLOOD_RISK_DISCLAIMER =
  'Experimental Stage-1 rule baseline: BMKG rainfall-intensity categories adjusted by BNPB InaRISK flood susceptibility and official river-gauge status. Not a probability and not calibrated against local flood history; not a BMKG/BNPB warning.';

/**
 * Milestone 3: rainfall-driven flood-risk levels for every kabupaten/kota
 * point from stored data only (no provider calls), via ai-engine
 * `/predict-rain-flood-risk`. Every run — including refused and failed
 * ones — is persisted in `rainfall_risk_runs` with the thresholds used and
 * where each input came from (docs/RAINFALL_INTELLIGENCE.md).
 */
@Injectable()
export class RainfallFloodRiskService {
  private readonly logger = new Logger(RainfallFloodRiskService.name);
  private running = false;

  constructor(
    private readonly engine: RainfallEngineClient,
    private readonly config: ConfigService,
    private readonly hazardIndex: DistrictHazardIndexService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectRepository(RainfallRiskRun)
    private readonly runRepository: Repository<RainfallRiskRun>,
  ) {}

  /** Returns null if a run is already in progress in this process. */
  async run(
    trigger: 'scheduled' | 'manual',
    now: Date = new Date(),
  ): Promise<RainfallRiskRun | null> {
    if (this.running) return null;
    this.running = true;
    const run = this.runRepository.create({
      hazard: 'flood',
      status: 'failed',
      trigger,
      issuedAt: now,
      dataValidTime: null,
      modelVersion: null,
      parameters: {},
      inputSummary: null,
      results: null,
      warnings: [],
      error: null,
    });
    try {
      await this.execute(run, now);
    } catch (error) {
      run.status = 'failed';
      run.error = (error as Error).message;
      this.logger.error(`Flood risk run failed: ${run.error}`);
    } finally {
      run.completedAt = new Date();
      this.running = false;
    }
    return this.runRepository.save(run);
  }

  private async execute(run: RainfallRiskRun, now: Date): Promise<void> {
    const priorities = rainfallSourcePriorities((key) => this.config.get(key));
    const districts = await getDistrictPoints(this.districtRepository);
    const samples = await loadRainfallSamples(
      this.sampleRepository,
      priorities.map((p) => p.source),
      new Date(now.getTime() - SAMPLE_LOOKBACK_HOURS * HOUR_MS),
    );
    const indices = await this.hazardIndex.load(BNPB_LAYER_FLOOD_HAZARD_INDEX);
    const breaks = nationalTerciles(
      [...indices.values()]
        .map((i) => i.valueMean)
        .filter((v): v is number => v !== null),
    );
    const gauges = assignGaugesToDistricts(
      await this.loadGauges(now),
      districts,
      GAUGE_MAX_DISTANCE_KM,
    );

    const points: FloodPointIn[] = districts.map((district) => {
      const bySource = samples.get(district.id) ?? new Map();
      const index = indices.get(district.id);
      const rainfall = selectFloodRainfall(bySource, priorities, now);
      const antecedent = selectAntecedentRainfall(bySource, priorities, now);
      const soilMoisture = selectSoilMoisture(bySource, priorities, now);
      const gauge = gauges.get(district.id);
      return {
        id: district.id,
        ...(rainfall ? { rainfall } : {}),
        ...(antecedent ? { antecedent } : {}),
        ...(soilMoisture ? { soilMoisture } : {}),
        ...(index
          ? {
              susceptibility: {
                source: HAZARD_INDEX_SOURCE,
                floodHazardIndex: index.valueMean,
              },
            }
          : {}),
        ...(gauge ? { gauge } : {}),
      };
    });

    if (!indices.size) {
      run.warnings.push(
        'No InaRISK flood hazard index stored yet (refresh pending?): susceptibility unknown everywhere, levels are never lowered.',
      );
    } else if (!breaks) {
      run.warnings.push(
        'Too few districts with an InaRISK flood index for national terciles: susceptibility unknown.',
      );
    }
    const withRain = points.filter((p) => p.rainfall).length;
    run.inputSummary = this.summarize(points, districts, indices.size, breaks);
    if (withRain === 0) {
      run.status = 'insufficient_data';
      run.warnings.push(
        'No stored rainfall for any district in the last 7 days (ingestion not running?).',
      );
      return;
    }

    const response = await this.engine.predictRainFloodRisk({
      issuedAt: now.toISOString(),
      points,
      parameters: { susceptibilityBreaks: breaks },
    });
    run.status = 'completed';
    run.modelVersion = response.modelVersion;
    run.parameters = {
      ...response.parameters,
      calibrated: response.calibrated,
      factorBases: response.factorBases,
      gaugeMaxAgeHours: GAUGE_MAX_AGE_MS / HOUR_MS,
      gaugeMaxDistanceKm: GAUGE_MAX_DISTANCE_KM,
    };
    run.inputSummary = {
      ...run.inputSummary,
      missingInputs: response.missingInputs,
    };
    const validTimes = points
      .map((p) => p.rainfall?.validTime)
      .filter((t): t is string => !!t)
      .sort();
    run.dataValidTime = validTimes.length
      ? new Date(validTimes[validTimes.length - 1])
      : null;
    run.results = response.points;
  }

  private summarize(
    points: FloodPointIn[],
    districts: DistrictPoint[],
    indexedDistricts: number,
    breaks: [number, number] | null,
  ): Record<string, unknown> {
    const count = (keys: Array<string | undefined>) =>
      keys.reduce<Record<string, number>>((acc, key) => {
        const k = key ?? 'none';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
    return {
      districts: districts.length,
      rainfallSource: count(points.map((p) => p.rainfall?.source)),
      rainfallFreshness: count(points.map((p) => p.rainfall?.freshness)),
      antecedentSource: count(points.map((p) => p.antecedent?.source)),
      susceptibility: {
        source: HAZARD_INDEX_SOURCE,
        layer: BNPB_LAYER_FLOOD_HAZARD_INDEX,
        districtsIndexed: indexedDistricts,
        districtsWithValue: points.filter(
          (p) => p.susceptibility?.floodHazardIndex != null,
        ).length,
        nationalTerciles: breaks,
      },
      gauges: {
        source: PETABENCANA_SOURCE,
        districtsWithGauge: points.filter((p) => p.gauge).length,
      },
      attribution: [GSMAP_ATTRIBUTION, OPEN_METEO_ATTRIBUTION],
      disclaimer: FLOOD_RISK_DISCLAIMER,
    };
  }

  /** Recent PetaBencana gauge readings with an official Siaga label. */
  private async loadGauges(now: Date): Promise<GaugeReading[]> {
    const events = await this.hazardEventRepository
      .createQueryBuilder('e')
      .where('e.source = :source', { source: PETABENCANA_SOURCE })
      .andWhere('e.eventTime > :since', {
        since: new Date(now.getTime() - GAUGE_MAX_AGE_MS),
      })
      .andWhere('e.eventTime <= :now', { now })
      .getMany();
    return events.flatMap((event) => {
      const payload = event.rawPayload as {
        alertLevel?: string;
        gaugeName?: string;
      };
      const alertLevel = parseSiagaLevel(payload.alertLevel);
      if (alertLevel === null) return [];
      return [
        {
          source: PETABENCANA_SOURCE,
          name: payload.gaugeName ?? event.locationLabel ?? 'gauge',
          latitude: event.latitude,
          longitude: event.longitude,
          alertLevel,
          observedAt: event.eventTime,
        },
      ];
    });
  }

  async latest(districtId?: string) {
    const run = await this.runRepository.findOne({
      where: { hazard: 'flood' },
      order: { issuedAt: 'DESC' },
    });
    if (!run) throw new NotFoundException('No flood risk run yet');
    if (!districtId) return run;
    const result = (run.results ?? []).find(
      (point) => (point as { id: string }).id === districtId,
    );
    if (!result) {
      throw new NotFoundException(
        `No flood risk for district ${districtId} in the latest run`,
      );
    }
    return { ...run, results: [result] };
  }
}
