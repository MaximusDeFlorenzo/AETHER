import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { District, WeatherHourlySample } from '../database/entities';
import { DataSourceSyncService } from '../ingestion/data-source-sync.service';
import { withRetry } from '../karhutla-prediction/providers/retry';
import {
  normalizeOpenMeteoHourly,
  OPEN_METEO_HOURLY_VARIABLES,
  type OpenMeteoHourlyResponse,
} from './lib/normalize';
import { WeatherDataKind } from './rainfall.enums';
import {
  DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
  OPEN_METEO_SOURCE,
  RAINFALL_SYNC_SOURCE_ID,
} from './rainfall.constants';
import {
  getDistrictPoints,
  upsertHourlySamples,
  type DistrictPoint,
} from './weather-samples.store';

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1';
const HOUR_MS = 60 * 60 * 1000;
// Open-Meteo accepts comma-separated multi-location requests; same batch
// size OpenMeteoAtmosphereProvider uses.
const MAX_LOCATIONS_PER_REQUEST = 50;
// First run (or a district with no history): backfill one week, enough for
// the 168 h antecedent-rainfall window. Under Open-Meteo's 2-week mark, so
// it doesn't count as extra calls.
const MAX_LOOKBACK_HOURS = 168;
// Re-fetch one already-stored hour each run, so an hour the provider had
// not finalized last time gets its newer value.
const OVERLAP_HOURS = 1;

export interface RainfallIngestionSummary {
  startedAt: string;
  completedAt: string;
  districts: number;
  lookbackHours: number;
  samplesWritten: number;
  batches: number;
  batchesFailed: number;
  districtsWithoutData: number;
  futureHoursDropped: number;
  duplicateHoursDropped: number;
  unrecognizedUnits: string[];
  /** Open-Meteo answered 429: the run stopped early (see runIngestion). */
  rateLimited: boolean;
}

/**
 * Milestone 1 ingestion (docs/RAINFALL_INTELLIGENCE.md): hourly Open-Meteo
 * weather at every kabupaten/kota reference point → normalized, validated
 * → upserted into `weather_hourly_samples`. Values are NWP model output,
 * stored with `data_kind = 'nwp_model'`.
 *
 * Idempotent: rows are keyed (district, source, valid_time), so overlapping
 * or repeated runs update instead of duplicating. The lookback window
 * stretches automatically to cover a gap after downtime (up to one week).
 */
@Injectable()
export class RainfallIngestionService {
  private readonly logger = new Logger(RainfallIngestionService.name);
  private running = false;
  private lastSummary: RainfallIngestionSummary | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
    private readonly dataSourceSync: DataSourceSyncService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  getLastSummary(): RainfallIngestionSummary | null {
    return this.lastSummary;
  }

  /** Returns null if a run is already in progress in this process. */
  async ingest(
    now: Date = new Date(),
  ): Promise<RainfallIngestionSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const summary = await this.runIngestion(now);
      if (summary.districts > 0 && summary.samplesWritten === 0) {
        await this.dataSourceSync.recordFailure(
          RAINFALL_SYNC_SOURCE_ID,
          summary.rateLimited
            ? 'Open-Meteo rate limit reached (HTTP 429) — no samples written'
            : `All ${summary.batches} Open-Meteo batches failed`,
        );
      } else {
        await this.dataSourceSync.recordSuccess(RAINFALL_SYNC_SOURCE_ID);
      }
      this.lastSummary = summary;
      return summary;
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Rainfall ingestion failed: ${message}`);
      await this.dataSourceSync.recordFailure(RAINFALL_SYNC_SOURCE_ID, message);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async runIngestion(now: Date): Promise<RainfallIngestionSummary> {
    const startedAt = new Date();
    const districts = await getDistrictPoints(this.districtRepository);
    const lookbackHours = await this.lookbackHours(now, districts.length);
    const summary: RainfallIngestionSummary = {
      startedAt: startedAt.toISOString(),
      completedAt: startedAt.toISOString(),
      districts: districts.length,
      lookbackHours,
      samplesWritten: 0,
      batches: 0,
      batchesFailed: 0,
      districtsWithoutData: 0,
      futureHoursDropped: 0,
      duplicateHoursDropped: 0,
      unrecognizedUnits: [],
      rateLimited: false,
    };
    const unrecognized = new Set<string>();

    for (let i = 0; i < districts.length; i += MAX_LOCATIONS_PER_REQUEST) {
      const batch = districts.slice(i, i + MAX_LOCATIONS_PER_REQUEST);
      summary.batches += 1;
      let responses: OpenMeteoHourlyResponse[];
      try {
        responses = await this.fetchBatch(batch, lookbackHours);
      } catch (error) {
        summary.batchesFailed += 1;
        if ((error as AxiosError)?.response?.status === 429) {
          // Open-Meteo's minutely/hourly/daily quota is shared with every
          // other Open-Meteo caller in apps/api; more requests now only
          // extend the lockout. Stop — the next run's lookback reaches back
          // to the most-behind district, so the gap is backfilled then.
          summary.rateLimited = true;
          summary.districtsWithoutData += districts.length - i;
          this.logger.warn(
            `Open-Meteo rate limit (429) — stopping after ${i} of ${districts.length} districts; the next run backfills the rest`,
          );
          break;
        }
        summary.districtsWithoutData += batch.length;
        this.logger.warn(
          `Open-Meteo hourly fetch failed for ${batch.length} district(s): ${(error as Error).message}`,
        );
        continue;
      }

      const retrievedAt = new Date();
      const rows: Array<Partial<WeatherHourlySample>> = [];
      batch.forEach((district, index) => {
        const response = responses[index];
        const normalized = response
          ? normalizeOpenMeteoHourly(response, now)
          : null;
        if (!normalized || normalized.samples.length === 0) {
          summary.districtsWithoutData += 1;
          return;
        }
        summary.futureHoursDropped += normalized.futureHoursDropped;
        summary.duplicateHoursDropped += normalized.duplicateHoursDropped;
        normalized.unrecognizedUnits.forEach((u) => unrecognized.add(u));
        for (const sample of normalized.samples) {
          rows.push({
            district: { id: district.id } as District,
            source: OPEN_METEO_SOURCE,
            dataKind: WeatherDataKind.NWP_MODEL,
            latitude: district.latitude,
            longitude: district.longitude,
            retrievedAt,
            ...sample,
          });
        }
      });
      summary.samplesWritten += await upsertHourlySamples(
        this.sampleRepository,
        rows,
      );
    }

    summary.unrecognizedUnits = [...unrecognized];
    summary.completedAt = new Date().toISOString();
    this.logger.log(
      `Rainfall ingestion: ${summary.samplesWritten} hourly samples for ${summary.districts - summary.districtsWithoutData}/${summary.districts} districts (lookback ${lookbackHours} h, ${summary.batchesFailed}/${summary.batches} batches failed)`,
    );
    return summary;
  }

  private async fetchBatch(
    batch: DistrictPoint[],
    pastHours: number,
  ): Promise<OpenMeteoHourlyResponse[]> {
    const baseUrl =
      this.config.get<string>('OPEN_METEO_BASE_URL') ?? DEFAULT_BASE_URL;
    const { data } = await withRetry(() =>
      firstValueFrom(
        this.http.get<OpenMeteoHourlyResponse | OpenMeteoHourlyResponse[]>(
          `${baseUrl}/forecast`,
          {
            params: {
              latitude: batch.map((d) => d.latitude).join(','),
              longitude: batch.map((d) => d.longitude).join(','),
              hourly: OPEN_METEO_HOURLY_VARIABLES.join(','),
              past_hours: pastHours,
              // Includes the current (completed-at-the-hour) step; anything
              // after `now` is dropped by the normalizer.
              forecast_hours: 1,
              wind_speed_unit: 'kmh',
              timezone: 'GMT',
            },
            timeout: 20_000,
          },
        ),
      ),
    );
    return Array.isArray(data) ? data : [data];
  }

  /**
   * Hours to fetch: from the most-behind district's newest stored hour to
   * now (+ overlap), at least one ingestion interval, at most one week. Any
   * district with no history at all forces the full one-week backfill.
   */
  private async lookbackHours(
    now: Date,
    districtCount: number,
  ): Promise<number> {
    const intervalMs = Number(
      this.config.get('RAINFALL_INGESTION_INTERVAL_MS') ??
        DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
    );
    const minHours =
      Math.ceil((intervalMs || HOUR_MS) / HOUR_MS) + OVERLAP_HOURS;
    const [row] = await this.sampleRepository.query<
      Array<{ districts: string; oldestLatest: Date | null }>
    >(
      `SELECT COUNT(*) AS "districts", MIN(latest.max_valid_time) AS "oldestLatest"
       FROM (
         SELECT district_id, MAX(valid_time) AS max_valid_time
         FROM weather_hourly_samples
         WHERE source = $1
         GROUP BY district_id
       ) latest`,
      [OPEN_METEO_SOURCE],
    );
    const covered = Number(row?.districts ?? 0);
    if (covered < districtCount || !row?.oldestLatest)
      return MAX_LOOKBACK_HOURS;
    const gapHours = Math.ceil(
      (now.getTime() - new Date(row.oldestLatest).getTime()) / HOUR_MS,
    );
    return Math.min(
      MAX_LOOKBACK_HOURS,
      Math.max(minHours, gapHours + OVERLAP_HOURS),
    );
  }
}
