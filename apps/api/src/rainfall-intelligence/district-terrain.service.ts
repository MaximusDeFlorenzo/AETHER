import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { District, DistrictTerrainProfile } from '../database/entities';
import { summarizeTerrain, terrainSites } from './lib/terrain';
import { getDistrictPoints, type DistrictPoint } from './weather-samples.store';

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1';
export const TERRAIN_SOURCE = 'open-meteo-elevation';
export const TERRAIN_DEM = 'Copernicus GLO-90';
// 4 × 4 sites × 4 stencil points = 64 coordinates: one request (the API
// takes up to 100).
export const TERRAIN_GRID_SIZE = 4;
// Same ±0.05° footprint as the GSMaP 0.1° rainfall cell around the point
// and as the InaRISK samples, so slope describes the area the rain does.
export const TERRAIN_GRID_HALF_WIDTH_DEG = 0.05;
// One GLO-90 pixel (3 arc-seconds): the stencil hits adjacent pixels.
export const TERRAIN_STENCIL_OFFSET_DEG = 1 / 1200;
// The DEM is static; yearly re-sampling only catches a republished DEM.
export const TERRAIN_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The free tier also caps 600 calls/min, and coordinates do count
// individually: an unpaced refresh got HTTP 429 on its 10th 64-coordinate
// request (640 coordinates) on 2026-10-07. One request per 8 s stays at
// ~480 coordinates/min.
export const TERRAIN_REQUEST_INTERVAL_MS = 8_000;
const DEFAULT_DISTRICTS_PER_DAY = 60;

export interface TerrainRefreshSummary {
  districtsDue: number;
  districtsSampled: number;
  /** Request failed; not stored, retried next refresh. */
  districtsFailed: number;
  /** Districts left for later because the rolling 24 h budget is spent. */
  districtsDeferred: number;
  rateLimited: boolean;
  startedAt: string;
  finishedAt: string;
}

/**
 * Samples Copernicus GLO-90 slope around every kabupaten/kota point into
 * `district_terrain_profiles` (docs/RAINFALL_INTELLIGENCE.md, Milestone 4)
 * via Open-Meteo's keyless elevation API — the same source the karhutla
 * TerrainProvider uses.
 *
 * Open-Meteo shares one free tier (10k calls/day) with rainfall ingestion
 * and does not document how multi-coordinate requests are counted; the
 * per-minute limit shows every coordinate counts (see
 * TERRAIN_REQUEST_INTERVAL_MS). Requests are paced, and at most
 * TERRAIN_SAMPLING_DISTRICTS_PER_DAY districts are sampled per rolling
 * 24 h, counted from the table itself so API restarts cannot exceed it.
 * HTTP 429 stops the refresh.
 */
@Injectable()
export class DistrictTerrainService {
  private readonly logger = new Logger(DistrictTerrainService.name);
  private running = false;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(DistrictTerrainProfile)
    private readonly profileRepository: Repository<DistrictTerrainProfile>,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  /** Returns false if a refresh is already running. */
  startInBackground(): boolean {
    if (this.running) return false;
    void this.refresh().catch((error: Error) =>
      this.logger.error(`Terrain refresh failed: ${error.message}`),
    );
    return true;
  }

  async refresh(now: Date = new Date()): Promise<TerrainRefreshSummary | null> {
    if (this.running) return null;
    this.running = true;
    const startedAt = new Date();
    try {
      const districts = await getDistrictPoints(this.districtRepository);
      const fresh = await this.freshDistrictIds(now);
      const due = districts.filter((d) => !fresh.has(d.id));
      const budget = Math.max(
        0,
        this.districtsPerDay() - (await this.sampledInLastDay(now)),
      );
      const batch = due.slice(0, budget);
      let sampled = 0;
      let failed = 0;
      let rateLimited = false;
      for (const [i, district] of batch.entries()) {
        if (i > 0) await this.pause(TERRAIN_REQUEST_INTERVAL_MS);
        const result = await this.sample(district, now);
        if (result === 'rate_limited') {
          rateLimited = true;
          break;
        }
        if (result === null) {
          failed += 1;
          continue;
        }
        await this.profileRepository
          .createQueryBuilder()
          .insert()
          .into(DistrictTerrainProfile)
          .values(result)
          .orUpdate(
            [
              'source',
              'dem',
              'slope_samples_deg',
              'slope_median_deg',
              'slope_max_deg',
              'elevation_mean_m',
              'elevation_min_m',
              'elevation_max_m',
              'samples_planned',
              'samples_valid',
              'grid_half_width_deg',
              'stencil_offset_deg',
              'sampled_at',
            ],
            ['district_id'],
          )
          .execute();
        sampled += 1;
      }
      if (batch.length > 0) {
        this.logger.log(
          `Terrain: ${sampled} district(s) sampled, ${failed} failed, ${due.length - sampled} still due${rateLimited ? ' (rate limited)' : ''}`,
        );
      }
      return {
        districtsDue: due.length,
        districtsSampled: sampled,
        districtsFailed: failed,
        districtsDeferred: due.length - batch.length,
        rateLimited,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
      };
    } finally {
      this.running = false;
    }
  }

  /** district id → stored profile. */
  async load(): Promise<Map<string, DistrictTerrainProfile>> {
    const rows = await this.profileRepository
      .createQueryBuilder('t')
      .leftJoin('t.district', 'district')
      .addSelect('district.id')
      .getMany();
    return new Map(rows.map((row) => [row.district.id, row]));
  }

  /** Overridden in tests. */
  protected pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private districtsPerDay(): number {
    const value = Number(
      this.config.get('TERRAIN_SAMPLING_DISTRICTS_PER_DAY') ??
        DEFAULT_DISTRICTS_PER_DAY,
    );
    return Number.isFinite(value) ? value : DEFAULT_DISTRICTS_PER_DAY;
  }

  private async freshDistrictIds(now: Date): Promise<Set<string>> {
    const rows = await this.profileRepository.query<
      Array<{ district_id: string }>
    >(
      `SELECT district_id FROM district_terrain_profiles WHERE sampled_at > $1`,
      [new Date(now.getTime() - TERRAIN_MAX_AGE_MS)],
    );
    return new Set(rows.map((r) => r.district_id));
  }

  private async sampledInLastDay(now: Date): Promise<number> {
    const [row] = await this.profileRepository.query<Array<{ n: string }>>(
      `SELECT count(*) AS n FROM district_terrain_profiles WHERE sampled_at > $1`,
      [new Date(now.getTime() - DAY_MS)],
    );
    return Number(row?.n ?? 0);
  }

  private async sample(
    district: DistrictPoint,
    now: Date,
  ): Promise<Partial<DistrictTerrainProfile> | null | 'rate_limited'> {
    const sites = terrainSites(
      district.latitude,
      district.longitude,
      TERRAIN_GRID_SIZE,
      TERRAIN_GRID_HALF_WIDTH_DEG,
      TERRAIN_STENCIL_OFFSET_DEG,
    );
    const points = sites.flatMap((s) => s.stencil);
    const baseUrl =
      this.config.get<string>('OPEN_METEO_BASE_URL') ?? DEFAULT_BASE_URL;
    let elevations: unknown[];
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ elevation?: unknown[] }>(`${baseUrl}/elevation`, {
          params: {
            latitude: points.map((p) => p.latitude.toFixed(6)).join(','),
            longitude: points.map((p) => p.longitude.toFixed(6)).join(','),
          },
          timeout: 15_000,
        }),
      );
      elevations = data.elevation ?? [];
    } catch (error) {
      if ((error as AxiosError)?.response?.status === 429) {
        return 'rate_limited';
      }
      this.logger.warn(
        `Elevation lookup failed for district ${district.id}: ${(error as Error).message}`,
      );
      return null;
    }
    if (elevations.length !== points.length) return null;
    const values = elevations.map((v) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null,
    );
    return {
      district: { id: district.id } as District,
      source: TERRAIN_SOURCE,
      dem: TERRAIN_DEM,
      ...summarizeTerrain(sites, values, TERRAIN_STENCIL_OFFSET_DEG),
      gridHalfWidthDeg: TERRAIN_GRID_HALF_WIDTH_DEG,
      stencilOffsetDeg: TERRAIN_STENCIL_OFFSET_DEG,
      sampledAt: now,
    };
  }
}
