import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  PopulationStatistic,
  RainfallNowcastRun,
  RainfallRiskRun,
} from '../database/entities';
import type { OutlookSeverity } from './dto/query-rainfall-outlook.dto';
import { classifyFreshness } from './lib/features';
import {
  buildRainfallRecommendations,
  RAINFALL_RULES_VERSION,
  type FloodSummary,
  type LandslideSummary,
  type RainSummary,
} from './lib/rainfall-recommendations';
import type {
  FloodFactor,
  FloodRiskPoint,
  LandslideRiskPoint,
  RainNowcastPoint,
} from './rainfall-engine.client';
import { DEFAULT_GSMAP_INGESTION_INTERVAL_MS } from './rainfall.constants';

const RANK: Record<OutlookSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  EXTREME: 3,
};
// The +1 h forecast used for "more rain indicated": the gated Stage-2 model
// when promoted, else tracked-motion advection (best +1 h baseline in the
// §4 backtest), else persistence.
const NEXT_HOUR_METHODS = [
  'spatial_logistic',
  'motion_advection',
  'persistence',
] as const;

export const OUTLOOK_DISCLAIMER =
  'Decision support only. Levels and recommendations come from experimental, uncalibrated rules over satellite and model data; they are not BMKG or BNPB warnings and never an evacuation order.';
const AFFECTED_AREA_NOTE =
  'The affected area is the district reference point and its ~11 km rainfall cell; no inundation or runout model exists, so specific villages cannot be named.';

/**
 * Milestone 6: one district-level hydrometeorological outlook built from
 * the latest stored nowcast, flood-risk and landslide-risk runs, plus
 * population as exposure context, with rule-based recommendations
 * (lib/rainfall-recommendations.ts). Computed on read from stored runs —
 * deterministic, so the run ids and rules version fully reproduce it.
 * Exposure orders districts and is reported; it never changes a level.
 */
@Injectable()
export class RainfallOutlookService {
  constructor(
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(PopulationStatistic)
    private readonly populationRepository: Repository<PopulationStatistic>,
    @InjectRepository(RainfallNowcastRun)
    private readonly nowcastRepository: Repository<RainfallNowcastRun>,
    @InjectRepository(RainfallRiskRun)
    private readonly riskRepository: Repository<RainfallRiskRun>,
  ) {}

  async outlook(
    options: {
      districtId?: string;
      minSeverity?: OutlookSeverity;
      compact?: boolean;
    } = {},
    now: Date = new Date(),
  ) {
    const [nowcast, flood, landslide] = await Promise.all([
      this.nowcastRepository.findOne({
        where: { status: 'completed' },
        order: { issuedAt: 'DESC' },
      }),
      this.latestRisk('flood'),
      this.latestRisk('landslide'),
    ]);
    const byId = <T extends { id: string }>(rows: unknown[] | null) =>
      new Map(((rows ?? []) as T[]).map((r) => [r.id, r]));
    const nowcastPoints = byId<RainNowcastPoint>(nowcast?.results ?? null);
    const floodPoints = byId<FloodRiskPoint>(flood?.results ?? null);
    const landslidePoints = byId<LandslideRiskPoint>(
      landslide?.results ?? null,
    );

    const districts = await this.loadDistricts(options.districtId);
    if (options.districtId && !districts.length) {
      throw new NotFoundException(`District ${options.districtId} not found`);
    }
    const population = await this.loadPopulation(
      options.districtId ? [options.districtId] : null,
    );
    const rainFreshness = nowcast?.dataValidTime
      ? classifyFreshness(
          (now.getTime() - nowcast.dataValidTime.getTime()) / 60_000,
          DEFAULT_GSMAP_INGESTION_INTERVAL_MS,
        )
      : null;
    const calibrated = Boolean(
      (nowcast?.parameters as { calibrated?: boolean } | undefined)?.calibrated,
    );

    const entries = districts.map((district) => {
      const rain = rainSummary(
        nowcastPoints.get(district.id),
        rainFreshness,
        calibrated,
      );
      const floodSummary = floodSummaryOf(floodPoints.get(district.id));
      const landslideSummary = landslideSummaryOf(
        landslidePoints.get(district.id),
      );
      const levels = [floodSummary, landslideSummary]
        .filter((s) => s?.status === 'ok' && s.level)
        .map((s) => s!.level as OutlookSeverity);
      const severity = levels.length
        ? levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a))
        : null;
      const point = nowcastPoints.get(district.id);
      const exposure = population.get(district.id) ?? null;
      const recommendations = buildRainfallRecommendations({
        flood: floodSummary,
        landslide: landslideSummary,
        rain,
      });
      return {
        districtId: district.id,
        districtName: district.name,
        provinceName: district.provinceName,
        latitude: district.latitude,
        longitude: district.longitude,
        severity,
        rain: rain
          ? {
              ...rain,
              dataValidTime: nowcast?.dataValidTime ?? null,
              movement: point
                ? {
                    status: point.movement.status,
                    towardDeg: point.movement.towardDeg,
                    speedKmh: point.movement.speedKmh,
                    confidence: point.movement.confidence,
                  }
                : null,
            }
          : null,
        flood: options.compact ? withoutReasons(floodSummary) : floodSummary,
        landslide: options.compact
          ? withoutReasons(landslideSummary)
          : landslideSummary,
        exposure,
        recommendationCodes: recommendations.map((r) => r.code),
        ...(options.compact ? {} : { recommendations }),
      };
    });

    const filtered = options.minSeverity
      ? entries.filter(
          (e) =>
            e.severity !== null &&
            RANK[e.severity] >= RANK[options.minSeverity!],
        )
      : entries;
    filtered.sort(
      (a, b) =>
        (b.severity ? RANK[b.severity] : -1) -
          (a.severity ? RANK[a.severity] : -1) ||
        (b.exposure?.population ?? 0) - (a.exposure?.population ?? 0),
    );

    const runRef = (
      run: RainfallNowcastRun | RainfallRiskRun | null,
      versions: unknown,
    ) =>
      run
        ? {
            runId: run.id,
            issuedAt: run.issuedAt,
            dataValidTime: run.dataValidTime,
            modelVersions: versions,
          }
        : null;
    return {
      generatedAt: now.toISOString(),
      rulesVersion: RAINFALL_RULES_VERSION,
      sources: {
        nowcast: runRef(nowcast, nowcast?.modelVersions ?? null),
        flood: runRef(flood, flood?.modelVersion ?? null),
        landslide: runRef(landslide, landslide?.modelVersion ?? null),
        population: 'population_statistics (latest year per district)',
      },
      missing: [
        ...(nowcast ? [] : ['No completed rain nowcast run.']),
        ...(flood ? [] : ['No completed flood-risk run.']),
        ...(landslide ? [] : ['No completed landslide-risk run.']),
      ],
      affectedAreaNote: AFFECTED_AREA_NOTE,
      disclaimer: OUTLOOK_DISCLAIMER,
      districts: filtered,
    };
  }

  private latestRisk(hazard: 'flood' | 'landslide') {
    return this.riskRepository.findOne({
      where: { hazard, status: 'completed' },
      order: { issuedAt: 'DESC' },
    });
  }

  private async loadDistricts(districtId?: string) {
    const qb = this.districtRepository
      .createQueryBuilder('d')
      .leftJoin('d.province', 'p')
      .select('d.id', 'id')
      .addSelect('d.name', 'name')
      .addSelect('p.name', 'provinceName')
      .addSelect('ST_Y(ST_Centroid(d.geom))', 'latitude')
      .addSelect('ST_X(ST_Centroid(d.geom))', 'longitude')
      .orderBy('d.bps_code', 'ASC');
    if (districtId) qb.where('d.id = :districtId', { districtId });
    const rows = await qb.getRawMany<{
      id: string;
      name: string;
      provinceName: string | null;
      latitude: string;
      longitude: string;
    }>();
    return rows.map((r) => ({
      ...r,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    }));
  }

  /** district id → latest-year population. */
  private async loadPopulation(districtIds: string[] | null) {
    const rows = await this.populationRepository.query<
      Array<{
        district_id: string;
        year: number;
        total_population: string;
        population_density: string;
        source: string;
      }>
    >(
      `SELECT DISTINCT ON (district_id) district_id, year, total_population,
              population_density, source
       FROM population_statistics
       WHERE administrative_level = 'kabupaten_kota'
         AND ($1::uuid[] IS NULL OR district_id = ANY($1))
       ORDER BY district_id, year DESC`,
      [districtIds],
    );
    return new Map(
      rows.map((r) => [
        r.district_id,
        {
          population: Number(r.total_population),
          densityPerKm2: Number(r.population_density),
          year: r.year,
          source: r.source,
        },
      ]),
    );
  }
}

/** Compact view: drop the per-district reason lists (the bulk of the payload). */
function withoutReasons<T extends { confidenceReasons: string[] }>(
  summary: T | null,
): Omit<T, 'confidenceReasons'> | null {
  if (!summary) return null;
  const rest: Partial<T> = { ...summary };
  delete rest.confidenceReasons;
  return rest as Omit<T, 'confidenceReasons'>;
}

function describeFactor(factor: FloodFactor): string {
  const value =
    factor.value === null ? '' : ` ${Math.round(factor.value * 10) / 10}`;
  const unit = factor.value === null ? '' : ` ${factor.unit}`;
  const assessment = factor.assessment ? ` (${factor.assessment})` : '';
  return `${factor.factor}${value}${unit}${assessment}`;
}

function floodSummaryOf(
  point: FloodRiskPoint | undefined,
): FloodSummary | null {
  if (!point) return null;
  const gauge = point.factors.find(
    (f) => f.factor === 'river_gauge_alert' && f.effect === 'raised',
  );
  return {
    status: point.status,
    level: point.level,
    confidence: point.confidence,
    confidenceReasons: point.confidenceReasons,
    raisedBy: point.factors
      .filter((f) => f.effect === 'raised')
      .map(describeFactor),
    gauge: gauge
      ? {
          name: gauge.detail?.split(',')[0] ?? 'gauge',
          label: gauge.assessment ?? `Siaga ${gauge.value}`,
        }
      : null,
  };
}

function landslideSummaryOf(
  point: LandslideRiskPoint | undefined,
): LandslideSummary | null {
  if (!point) return null;
  return {
    status: point.status,
    level: point.level,
    confidence: point.confidence,
    confidenceReasons: point.confidenceReasons,
    raisedBy: point.factors
      .filter((f) => f.effect === 'raised')
      .map(describeFactor),
    terrainClass: point.terrainClass,
  };
}

function rainSummary(
  point: RainNowcastPoint | undefined,
  freshness: RainSummary['freshness'] | null,
  calibrated: boolean,
): RainSummary | null {
  if (!point || !freshness) return null;
  for (const method of NEXT_HOUR_METHODS) {
    const forecast = point.forecasts.find(
      (f) => f.method === method && f.horizonHours === 1 && f.status === 'ok',
    );
    if (forecast && forecast.probability !== null) {
      return {
        currentMmPerHour: point.currentMmPerHour,
        nextHourProbability: forecast.probability,
        method,
        calibrated,
        freshness,
      };
    }
  }
  return {
    currentMmPerHour: point.currentMmPerHour,
    nextHourProbability: null,
    method: null,
    calibrated,
    freshness,
  };
}
