import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  RainfallRiskRun,
  WeatherHourlySample,
} from '../database/entities';
import {
  DistrictTerrainService,
  TERRAIN_DEM,
} from './district-terrain.service';
import {
  selectAntecedentRainfall,
  selectFloodRainfall,
  selectSoilMoisture,
} from './lib/flood-inputs';
import { rainfallSourcePriorities } from './lib/trailing-rainfall';
import {
  RainfallEngineClient,
  type LandslidePointIn,
} from './rainfall-engine.client';
import {
  GSMAP_ATTRIBUTION,
  OPEN_METEO_ATTRIBUTION,
} from './rainfall.constants';
import {
  getDistrictPoints,
  loadRainfallSamples,
} from './weather-samples.store';

const HOUR_MS = 60 * 60 * 1000;
// 168 h context window + one ingestion interval of slack.
const SAMPLE_LOOKBACK_HOURS = 172;
const COPERNICUS_DEM_ATTRIBUTION =
  'Copernicus GLO-90 DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; via Open-Meteo';

export const LANDSLIDE_RISK_DISCLAIMER =
  'Experimental Stage-1 rule baseline: rainfall compared with global landslide intensity-duration thresholds (Guzzetti et al. 2008, Caine 1980), adjusted by 90 m DEM slope classes (Permen PU 22/PRT/M/2007). Not a probability, not calibrated against Indonesian landslide history, and not a BMKG/BNPB/PVMBG warning. Exposure is not included.';

/**
 * Milestone 4: rainfall-triggered landslide levels for every kabupaten/kota
 * point from stored data only (no provider calls), via ai-engine
 * `/predict-rain-landslide-risk`. Same run persistence as the flood
 * baseline (`rainfall_risk_runs`, hazard 'landslide').
 */
@Injectable()
export class RainfallLandslideRiskService {
  private readonly logger = new Logger(RainfallLandslideRiskService.name);
  private running = false;

  constructor(
    private readonly engine: RainfallEngineClient,
    private readonly config: ConfigService,
    private readonly terrain: DistrictTerrainService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
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
      hazard: 'landslide',
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
      this.logger.error(`Landslide risk run failed: ${run.error}`);
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
    const profiles = await this.terrain.load();

    const points: LandslidePointIn[] = districts.map((district) => {
      const bySource = samples.get(district.id) ?? new Map();
      const profile = profiles.get(district.id);
      const rainfall = selectFloodRainfall(bySource, priorities, now);
      const antecedent = selectAntecedentRainfall(bySource, priorities, now);
      const soilMoisture = selectSoilMoisture(bySource, priorities, now);
      return {
        id: district.id,
        ...(rainfall ? { rainfall } : {}),
        ...(antecedent ? { antecedent } : {}),
        ...(soilMoisture ? { soilMoisture } : {}),
        ...(profile
          ? {
              terrain: {
                source: profile.source,
                dem: profile.dem,
                slopeSamplesDeg: profile.slopeSamplesDeg,
              },
            }
          : {}),
      };
    });

    if (profiles.size < districts.length) {
      run.warnings.push(
        `DEM slope sampled for ${profiles.size} of ${districts.length} districts (sampling is spread over days to respect the Open-Meteo quota): terrain unknown elsewhere, levels there are never lowered.`,
      );
    }
    const withRain = points.filter((p) => p.rainfall || p.antecedent).length;
    run.inputSummary = this.summarize(points, districts.length, profiles.size);
    if (withRain === 0) {
      run.status = 'insufficient_data';
      run.warnings.push(
        'No stored rainfall for any district in the last 7 days (ingestion not running?).',
      );
      return;
    }

    const response = await this.engine.predictRainLandslideRisk({
      issuedAt: now.toISOString(),
      points,
    });
    run.status = 'completed';
    run.modelVersion = response.modelVersion;
    run.parameters = {
      ...response.parameters,
      calibrated: response.calibrated,
      factorBases: response.factorBases,
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
    points: LandslidePointIn[],
    districts: number,
    profiled: number,
  ): Record<string, unknown> {
    const count = (keys: Array<string | undefined>) =>
      keys.reduce<Record<string, number>>((acc, key) => {
        const k = key ?? 'none';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
    return {
      districts,
      rainfallSource: count(points.map((p) => p.rainfall?.source)),
      rainfallFreshness: count(points.map((p) => p.rainfall?.freshness)),
      antecedentSource: count(points.map((p) => p.antecedent?.source)),
      terrain: {
        dem: TERRAIN_DEM,
        districtsProfiled: profiled,
        districtsWithSlope: points.filter(
          (p) => (p.terrain?.slopeSamplesDeg.length ?? 0) > 0,
        ).length,
      },
      attribution: [
        GSMAP_ATTRIBUTION,
        OPEN_METEO_ATTRIBUTION,
        COPERNICUS_DEM_ATTRIBUTION,
      ],
      disclaimer: LANDSLIDE_RISK_DISCLAIMER,
    };
  }

  async latest(districtId?: string) {
    const run = await this.runRepository.findOne({
      where: { hazard: 'landslide' },
      order: { issuedAt: 'DESC' },
    });
    if (!run) throw new NotFoundException('No landslide risk run yet');
    if (!districtId) return run;
    const result = (run.results ?? []).find(
      (point) => (point as { id: string }).id === districtId,
    );
    if (!result) {
      throw new NotFoundException(
        `No landslide risk for district ${districtId} in the latest run`,
      );
    }
    return { ...run, results: [result] };
  }
}
