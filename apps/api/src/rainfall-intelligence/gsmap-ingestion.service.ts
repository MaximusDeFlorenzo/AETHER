import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  RainfallGrid,
  WeatherHourlySample,
} from '../database/entities';
import { DataSourceSyncService } from '../ingestion/data-source-sync.service';
import {
  extractGsmapDomain,
  INDONESIA_RAIN_DOMAIN,
  parseGsmapFileName,
  sampleGsmap,
  type GsmapFile,
  type GsmapProduct,
} from './lib/gsmap';
import { encodeRainGrid, RAIN_GRID_ENCODING } from './lib/rain-grid-codec';
import { GsmapFtpProvider } from './providers/gsmap-ftp.provider';
import { WeatherDataKind } from './rainfall.enums';
import { GSMAP_SYNC_SOURCE_ID } from './rainfall.constants';
import {
  getDistrictPoints,
  upsertHourlySamples,
  type DistrictPoint,
} from './weather-samples.store';

const HOUR_MS = 60 * 60 * 1000;
// /now/latest keeps 24 h; look a little further back when checking what
// is already stored.
const LATEST_WINDOW_HOURS = 26;
// The product whose Indonesia-domain field is kept in `rainfall_grids` for
// motion tracking and nowcast backtesting (gauge-calibrated; same product
// the conditions list and landslide trigger use).
export const GRID_PRODUCT: GsmapProduct = 'gsmap_gauge_now';

export interface GsmapIngestionSummary {
  status: 'completed' | 'not_configured';
  startedAt: string;
  completedAt: string;
  districts: number;
  /** Hour-aligned GSMaP_NOW + GSMaP_Gauge_NOW files in /now/latest. */
  filesAvailable: number;
  filesAlreadyStored: number;
  filesIngested: number;
  filesFailed: number;
  samplesWritten: number;
  /** Indonesia-domain rain fields stored (GRID_PRODUCT only). */
  gridsWritten: number;
  /** District-hours stored as NULL because GSMaP flagged them missing. */
  missingValues: number;
  latestValidTime: string | null;
}

/**
 * Ingests JAXA GSMaP_NOW and GSMaP_Gauge_NOW (satellite rainfall estimates,
 * 0.1°, hourly) into `weather_hourly_samples` at every kabupaten/kota point:
 * `source` = product name, `data_kind = 'satellite_estimate'`, only
 * `precipitation_mm` set. Downloads only the hours not yet stored for all
 * districts, so a steady-state run fetches 2 files (~2 MB each).
 *
 * Scope: the rolling 24 h in /now/latest. Longer backfill (archive) is left
 * for backtesting, where the better-quality GSMaP_NRT / MVK products apply
 * (docs/RAINFALL_INTELLIGENCE.md).
 */
@Injectable()
export class GsmapIngestionService {
  private readonly logger = new Logger(GsmapIngestionService.name);
  private running = false;
  private lastSummary: GsmapIngestionSummary | null = null;

  constructor(
    private readonly ftp: GsmapFtpProvider,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
    @InjectRepository(RainfallGrid)
    private readonly gridRepository: Repository<RainfallGrid>,
    private readonly dataSourceSync: DataSourceSyncService,
  ) {}

  isConfigured(): boolean {
    return this.ftp.isConfigured();
  }

  isRunning(): boolean {
    return this.running;
  }

  getLastSummary(): GsmapIngestionSummary | null {
    return this.lastSummary;
  }

  /**
   * Starts a run without awaiting it (a first run downloads ~48 files from
   * a slow FTP server — longer than an HTTP request should wait). Returns
   * false if a run is already in progress.
   */
  startInBackground(): boolean {
    if (this.running) return false;
    this.ingest().catch(() => undefined); // logged + recorded inside ingest
    return true;
  }

  /** Returns null if a run is already in progress in this process. */
  async ingest(now: Date = new Date()): Promise<GsmapIngestionSummary | null> {
    if (this.running) return null;
    this.running = true;
    const startedAt = new Date();
    try {
      if (!this.ftp.isConfigured()) {
        return this.finish(this.emptySummary(startedAt, 'not_configured', 0));
      }
      const summary = await this.runIngestion(now, startedAt);
      if (summary.filesIngested === 0 && summary.filesFailed > 0) {
        await this.dataSourceSync.recordFailure(
          GSMAP_SYNC_SOURCE_ID,
          `All ${summary.filesFailed} GSMaP file downloads failed`,
        );
      } else {
        await this.dataSourceSync.recordSuccess(GSMAP_SYNC_SOURCE_ID);
      }
      return this.finish(summary);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`GSMaP ingestion failed: ${message}`);
      await this.dataSourceSync.recordFailure(GSMAP_SYNC_SOURCE_ID, message);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private finish(summary: GsmapIngestionSummary): GsmapIngestionSummary {
    this.lastSummary = summary;
    return summary;
  }

  private emptySummary(
    startedAt: Date,
    status: GsmapIngestionSummary['status'],
    districts: number,
  ): GsmapIngestionSummary {
    return {
      status,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      districts,
      filesAvailable: 0,
      filesAlreadyStored: 0,
      filesIngested: 0,
      filesFailed: 0,
      samplesWritten: 0,
      gridsWritten: 0,
      missingValues: 0,
      latestValidTime: null,
    };
  }

  private async runIngestion(
    now: Date,
    startedAt: Date,
  ): Promise<GsmapIngestionSummary> {
    const districts = await getDistrictPoints(this.districtRepository);
    const summary = this.emptySummary(startedAt, 'completed', districts.length);
    if (districts.length === 0) return summary;
    const stored = await this.storedHours(now, districts.length);

    await this.ftp.withSession(async (session) => {
      const files = (await session.listLatest())
        .map(parseGsmapFileName)
        .filter((f): f is GsmapFile => f !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      summary.filesAvailable = files.length;

      for (const file of files) {
        if (stored.has(this.key(file.product, file.validTime))) {
          summary.filesAlreadyStored += 1;
          continue;
        }
        try {
          const grid = await session.downloadLatest(file.name);
          const { rows, missing } = this.rowsFor(file, grid, districts);
          summary.samplesWritten += await upsertHourlySamples(
            this.sampleRepository,
            rows,
          );
          summary.missingValues += missing;
          if (file.product === GRID_PRODUCT) {
            await this.storeGrid(file, grid);
            summary.gridsWritten += 1;
          }
          summary.filesIngested += 1;
        } catch (error) {
          summary.filesFailed += 1;
          this.logger.warn(
            `GSMaP file ${file.name} failed: ${(error as Error).message}`,
          );
        }
      }
      const newest = files[files.length - 1];
      summary.latestValidTime = newest ? newest.validTime.toISOString() : null;
    });

    summary.completedAt = new Date().toISOString();
    this.logger.log(
      `GSMaP ingestion: ${summary.filesIngested} file(s) ingested, ${summary.filesAlreadyStored} already stored, ${summary.filesFailed} failed (${summary.samplesWritten} samples, ${summary.missingValues} missing)`,
    );
    return summary;
  }

  private rowsFor(
    file: GsmapFile,
    grid: Buffer,
    districts: DistrictPoint[],
  ): { rows: Array<Partial<WeatherHourlySample>>; missing: number } {
    const retrievedAt = new Date();
    let missing = 0;
    const rows = districts.map((district) => {
      const value = sampleGsmap(grid, district.latitude, district.longitude);
      if (value.precipitationMm === null) missing += 1;
      return {
        district: { id: district.id } as District,
        source: file.product,
        dataKind: WeatherDataKind.SATELLITE_ESTIMATE,
        validTime: file.validTime,
        latitude: district.latitude,
        longitude: district.longitude,
        gridElevationM: null,
        precipitationMm: value.precipitationMm,
        qualityFlags: value.qualityFlags,
        retrievedAt,
      };
    });
    return { rows, missing };
  }

  private async storeGrid(file: GsmapFile, grid: Buffer): Promise<void> {
    const { values, missingCells } = extractGsmapDomain(grid);
    await this.gridRepository
      .createQueryBuilder()
      .insert()
      .into(RainfallGrid)
      .values({
        source: file.product,
        validTime: file.validTime,
        ...INDONESIA_RAIN_DOMAIN,
        encoding: RAIN_GRID_ENCODING,
        data: encodeRainGrid(values),
        missingCells,
        retrievedAt: new Date(),
      })
      .orUpdate(
        ['data', 'missing_cells', 'retrieved_at', 'encoding'],
        ['source', 'valid_time'],
      )
      .execute();
  }

  /**
   * (product, valid hour) pairs already fully stored: points for every
   * district and, for GRID_PRODUCT, the domain field too — so hours stored
   * before grids existed are re-fetched once to fill their field.
   */
  private async storedHours(
    now: Date,
    districtCount: number,
  ): Promise<Set<string>> {
    const since = new Date(now.getTime() - LATEST_WINDOW_HOURS * HOUR_MS);
    const rows = await this.sampleRepository.query<
      Array<{ source: string; valid_time: Date; n: string }>
    >(
      `SELECT source, valid_time, COUNT(*) AS n
       FROM weather_hourly_samples
       WHERE source IN ('gsmap_now', 'gsmap_gauge_now') AND valid_time >= $1
       GROUP BY source, valid_time`,
      [since],
    );
    const grids = await this.gridRepository.query<Array<{ valid_time: Date }>>(
      `SELECT valid_time FROM rainfall_grids WHERE source = $1 AND valid_time >= $2`,
      [GRID_PRODUCT, since],
    );
    const gridHours = new Set(
      grids.map((g) => new Date(g.valid_time).toISOString()),
    );
    return new Set(
      rows
        .filter((r) => Number(r.n) >= districtCount)
        .filter(
          (r) =>
            r.source !== GRID_PRODUCT ||
            gridHours.has(new Date(r.valid_time).toISOString()),
        )
        .map((r) => this.key(r.source, new Date(r.valid_time))),
    );
  }

  private key(source: string, validTime: Date): string {
    return `${source}|${validTime.toISOString()}`;
  }
}
