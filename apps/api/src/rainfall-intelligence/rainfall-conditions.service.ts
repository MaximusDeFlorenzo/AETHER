import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { District, WeatherHourlySample } from '../database/entities';
import { DataSourceSyncService } from '../ingestion/data-source-sync.service';
import {
  accumulate,
  buildRainfallFeatures,
  summarizeDataQuality,
  type DataQualitySummary,
  type HourlyValues,
  type RainfallFeatures,
} from './lib/features';
import { type CompassPoint } from './lib/wind';
import { WeatherDataKind } from './rainfall.enums';
import { GSMAP_PRODUCTS, type GsmapProduct } from './lib/gsmap';
import {
  DEFAULT_GSMAP_INGESTION_INTERVAL_MS,
  DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
  GSMAP_ATTRIBUTION,
  OPEN_METEO_ATTRIBUTION,
  OPEN_METEO_SOURCE,
  RAINFALL_SYNC_SOURCE_ID,
} from './rainfall.constants';
import type { Freshness } from './rainfall.enums';

const HOUR_MS = 60 * 60 * 1000;
// Detail view: the longest accumulation window (168 h) plus one hour.
const DETAIL_HISTORY_HOURS = 169;
// List view: 24 h accumulations, plus slack for a run or two of lag.
const LIST_HISTORY_HOURS = 36;
const LIST_WINDOWS = [1, 3, 6, 24];

export const RAINFALL_PROVENANCE = {
  source: OPEN_METEO_SOURCE,
  dataKind: WeatherDataKind.NWP_MODEL,
  description:
    'Numerical weather prediction model values (Open-Meteo best_match): past hours are model analyses/short-range forecasts, not rain-gauge or radar observations.',
  spatialSupport:
    'Single kabupaten/kota reference point (GeoNames), not an area average over the district.',
  attribution: OPEN_METEO_ATTRIBUTION,
} as const;

export const GSMAP_PROVENANCE = {
  sources: GSMAP_PRODUCTS,
  dataKind: WeatherDataKind.SATELLITE_ESTIMATE,
  description:
    'JAXA GSMaP_NOW satellite rainfall estimate (passive microwave + geostationary IR). The last half hour of each hourly window is extrapolated with cloud motion vectors, so the newest hour is partly a short forecast. gsmap_gauge_now is the gauge-calibrated variant. An estimate, not a rain-gauge measurement.',
  spatialSupport:
    '0.1° (~11 km) satellite cell containing the kabupaten/kota reference point.',
  attribution: GSMAP_ATTRIBUTION,
} as const;

// Satellite list/detail windows: GSMaP keeps a rolling 24 h.
const SATELLITE_WINDOWS = [1, 3, 6, 24];
const SATELLITE_COLUMNS = [
  'id',
  'source',
  'precipitationMm',
  'qualityFlags',
  'validTime',
] as const;

export interface SatelliteRainfall {
  source: GsmapProduct;
  status: 'ok' | 'stale' | 'no_data';
  latestValidTime: string | null;
  dataAgeMinutes: number | null;
  freshness: Freshness;
  latestHourMm: number | null;
  accumulations: Array<{
    windowHours: number;
    totalMm: number | null;
    availableMm: number;
    hoursAvailable: number;
    complete: boolean;
  }>;
  flags24h: Record<string, number>;
}

const SAMPLE_COLUMNS = [
  'id',
  'precipitationMm',
  'windSpeed10mKmh',
  'windFrom10mDeg',
  'windSpeed850hPaKmh',
  'windFrom850hPaDeg',
  'windSpeed700hPaKmh',
  'windFrom700hPaDeg',
  'temperatureC',
  'relativeHumidityPct',
  'surfacePressureHpa',
  'soilMoisture9To27cmM3m3',
  'qualityFlags',
  'validTime',
] as const;

export interface RainfallConditionsSummary {
  district: { id: string; name: string; bpsCode: string };
  status: 'ok' | 'stale' | 'no_data';
  latestValidTime: string | null;
  dataAgeMinutes: number | null;
  freshness: Freshness;
  latestHourMm: number | null;
  accumulations: Array<{
    windowHours: number;
    totalMm: number | null;
    complete: boolean;
  }>;
  wind10m: {
    speedKmh: number;
    fromDeg: number;
    compassFrom: CompassPoint;
  } | null;
  /** GSMaP_Gauge_NOW at the district point, kept separate from the model. */
  satellite: SatelliteRainfall | null;
}

export interface RainfallConditionsDetail {
  district: { id: string; name: string; bpsCode: string };
  status: 'ok' | 'stale' | 'no_data';
  generatedAt: string;
  provenance: typeof RAINFALL_PROVENANCE;
  dataQuality: DataQualitySummary & { issues: string[] };
  features: RainfallFeatures | null;
  hourly24h: Array<HourlyValues & { validTime: Date }>;
  /** Observed-side estimate, never merged into the model features above. */
  satellite: {
    provenance: typeof GSMAP_PROVENANCE;
    products: SatelliteRainfall[];
  };
}

/**
 * Read side of Milestone 1: rainfall conditions computed from stored
 * `weather_hourly_samples`. Never calls a provider — an empty or old table
 * is reported as `no_data` / `stale`, not silently refreshed.
 */
@Injectable()
export class RainfallConditionsService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
    private readonly dataSourceSync: DataSourceSyncService,
  ) {}

  private intervalMs(): number {
    const configured = Number(
      this.config.get('RAINFALL_INGESTION_INTERVAL_MS') ??
        DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
    );
    // 0 = scheduled ingestion disabled; judge freshness against the default
    // cadence rather than calling everything instantly stale.
    return configured > 0 ? configured : DEFAULT_RAINFALL_INGESTION_INTERVAL_MS;
  }

  private gsmapIntervalMs(): number {
    const configured = Number(
      this.config.get('GSMAP_INGESTION_INTERVAL_MS') ??
        DEFAULT_GSMAP_INGESTION_INTERVAL_MS,
    );
    return configured > 0 ? configured : DEFAULT_GSMAP_INGESTION_INTERVAL_MS;
  }

  private satelliteSamples(
    cutoff: Date,
    districtId?: string,
  ): Promise<WeatherHourlySample[]> {
    const qb = this.sampleRepository
      .createQueryBuilder('s')
      .select(SATELLITE_COLUMNS.map((c) => `s.${c}`))
      .leftJoin('s.district', 'd')
      .addSelect('d.id')
      .where({ source: In(GSMAP_PRODUCTS) })
      .andWhere('s.valid_time > :cutoff', { cutoff });
    if (districtId) qb.andWhere('s.district_id = :districtId', { districtId });
    return qb.orderBy('s.valid_time', 'ASC').getMany();
  }

  private satellite(
    source: GsmapProduct,
    samples: HourlyValues[],
    now: Date,
  ): SatelliteRainfall {
    const quality = summarizeDataQuality(samples, now, this.gsmapIntervalMs());
    const latest = quality.latestValidTime
      ? new Date(quality.latestValidTime)
      : null;
    const latestSample = latest
      ? samples.find((s) => s.validTime.getTime() === latest.getTime())
      : undefined;
    return {
      source,
      status: this.status(quality, samples.length),
      latestValidTime: quality.latestValidTime,
      dataAgeMinutes: quality.dataAgeMinutes,
      freshness: quality.freshness,
      latestHourMm: latestSample?.precipitationMm ?? null,
      accumulations: latest
        ? SATELLITE_WINDOWS.map((w) => {
            const a = accumulate(samples, latest, w);
            return {
              windowHours: a.windowHours,
              totalMm: a.totalMm,
              availableMm: a.availableMm,
              hoursAvailable: a.hoursAvailable,
              complete: a.complete,
            };
          })
        : [],
      flags24h: quality.flags24h,
    };
  }

  async listConditions(
    now: Date = new Date(),
  ): Promise<RainfallConditionsSummary[]> {
    const districts = await this.districtRepository.find({
      select: { id: true, name: true, bpsCode: true },
      order: { bpsCode: 'ASC' },
    });
    const rows = await this.sampleRepository
      .createQueryBuilder('s')
      .select(SAMPLE_COLUMNS.map((c) => `s.${c}`))
      .leftJoin('s.district', 'd')
      .addSelect('d.id')
      .where('s.source = :source', { source: OPEN_METEO_SOURCE })
      .andWhere('s.valid_time > :cutoff', {
        cutoff: new Date(now.getTime() - LIST_HISTORY_HOURS * HOUR_MS),
      })
      .getMany();
    const byDistrict = groupByDistrict(rows);
    const satelliteRows = await this.satelliteSamples(
      new Date(now.getTime() - LIST_HISTORY_HOURS * HOUR_MS),
    );
    const gaugeByDistrict = groupByDistrict(
      satelliteRows.filter((s) => s.source === 'gsmap_gauge_now'),
    );

    return districts.map((district) => {
      const gauge = gaugeByDistrict.get(district.id) ?? [];
      return {
        ...this.summarize(district, byDistrict.get(district.id) ?? [], now),
        satellite: gauge.length
          ? this.satellite('gsmap_gauge_now', gauge, now)
          : null,
      };
    });
  }

  async getConditions(
    districtId: string,
    now: Date = new Date(),
  ): Promise<RainfallConditionsDetail> {
    const district = await this.districtRepository.findOne({
      where: { id: districtId },
      select: { id: true, name: true, bpsCode: true },
    });
    if (!district) {
      throw new NotFoundException(`District ${districtId} not found`);
    }
    const samples: HourlyValues[] = await this.sampleRepository
      .createQueryBuilder('s')
      .select(SAMPLE_COLUMNS.map((c) => `s.${c}`))
      .where('s.district_id = :districtId', { districtId })
      .andWhere('s.source = :source', { source: OPEN_METEO_SOURCE })
      .andWhere('s.valid_time > :cutoff', {
        cutoff: new Date(now.getTime() - DETAIL_HISTORY_HOURS * HOUR_MS),
      })
      .orderBy('s.valid_time', 'ASC')
      .getMany();

    const quality = summarizeDataQuality(samples, now, this.intervalMs());
    const issues = await this.issues(quality, samples.length);
    const satelliteRows = await this.satelliteSamples(
      new Date(now.getTime() - DETAIL_HISTORY_HOURS * HOUR_MS),
      districtId,
    );
    const latest = quality.latestValidTime
      ? new Date(quality.latestValidTime)
      : null;
    return {
      district: this.ref(district),
      status: this.status(quality, samples.length),
      generatedAt: now.toISOString(),
      provenance: RAINFALL_PROVENANCE,
      dataQuality: { ...quality, issues },
      features: latest ? buildRainfallFeatures(samples, latest) : null,
      hourly24h: latest
        ? samples.filter(
            (s) => s.validTime.getTime() > latest.getTime() - 24 * HOUR_MS,
          )
        : [],
      satellite: {
        provenance: GSMAP_PROVENANCE,
        products: GSMAP_PRODUCTS.map((product) =>
          this.satellite(
            product,
            satelliteRows.filter((s) => s.source === product),
            now,
          ),
        ),
      },
    };
  }

  private summarize(
    district: District,
    samples: HourlyValues[],
    now: Date,
  ): Omit<RainfallConditionsSummary, 'satellite'> {
    const quality = summarizeDataQuality(samples, now, this.intervalMs());
    const latest = quality.latestValidTime
      ? new Date(quality.latestValidTime)
      : null;
    const features = latest ? buildRainfallFeatures(samples, latest) : null;
    const wind10m = features?.wind.find((w) => w.level === '10m')?.latest;
    return {
      district: this.ref(district),
      status: this.status(quality, samples.length),
      latestValidTime: quality.latestValidTime,
      dataAgeMinutes: quality.dataAgeMinutes,
      freshness: quality.freshness,
      latestHourMm: features?.intensity.latestHourMm ?? null,
      accumulations: (features?.accumulations ?? [])
        .filter((a) => LIST_WINDOWS.includes(a.windowHours))
        .map((a) => ({
          windowHours: a.windowHours,
          totalMm: a.totalMm,
          complete: a.complete,
        })),
      wind10m: wind10m
        ? {
            speedKmh: wind10m.speedKmh,
            fromDeg: wind10m.fromDeg,
            compassFrom: wind10m.compassFrom,
          }
        : null,
    };
  }

  private status(
    quality: DataQualitySummary,
    sampleCount: number,
  ): 'ok' | 'stale' | 'no_data' {
    if (sampleCount === 0) return 'no_data';
    return quality.freshness === 'stale' ? 'stale' : 'ok';
  }

  private async issues(
    quality: DataQualitySummary,
    sampleCount: number,
  ): Promise<string[]> {
    const issues: string[] = [];
    if (sampleCount === 0) {
      const lastSync = await this.dataSourceSync.getLastSyncedAt(
        RAINFALL_SYNC_SOURCE_ID,
      );
      issues.push(
        lastSync
          ? 'No stored hourly samples for this district in the last week.'
          : 'Rainfall ingestion has never run successfully.',
      );
      return issues;
    }
    if (quality.freshness !== 'fresh') {
      issues.push(
        `Latest stored hour is ${quality.dataAgeMinutes} min old (${quality.freshness}).`,
      );
    }
    if (quality.missingHours24h.length > 0) {
      issues.push(
        `${quality.missingHours24h.length} of the last 24 hours are missing; affected accumulations are reported as incomplete.`,
      );
    }
    if (Object.keys(quality.flags24h).length > 0) {
      issues.push(
        'Some values in the last 24 h were rejected (see flags24h) and are null.',
      );
    }
    return issues;
  }

  private ref(district: District) {
    return { id: district.id, name: district.name, bpsCode: district.bpsCode };
  }
}

function groupByDistrict<T extends { district: { id: string } }>(
  rows: T[],
): Map<string, T[]> {
  const byDistrict = new Map<string, T[]>();
  for (const row of rows) {
    const list = byDistrict.get(row.district.id) ?? [];
    list.push(row);
    byDistrict.set(row.district.id, list);
  }
  return byDistrict;
}
