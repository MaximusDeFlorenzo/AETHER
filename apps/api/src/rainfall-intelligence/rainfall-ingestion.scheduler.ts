import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  DEFAULT_GSMAP_INGESTION_INTERVAL_MS,
  DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
} from './rainfall.constants';
import { GsmapIngestionService } from './gsmap-ingestion.service';
import { RainfallIngestionService } from './rainfall-ingestion.service';
import { RainfallNowcastService } from './rainfall-nowcast.service';
import { RainfallFloodRiskService } from './rainfall-flood-risk.service';
import { DistrictHazardIndexService } from './district-hazard-index.service';
import { RainfallLandslideRiskService } from './rainfall-landslide-risk.service';
import { DistrictTerrainService } from './district-terrain.service';
import { RainfallSpatialModelService } from './rainfall-spatial-model.service';
import { DisasterLabelsService } from './disaster-labels.service';
import { GsmapArchiveService } from './gsmap-archive.service';
import { RainfallHazardBacktestService } from './rainfall-hazard-backtest.service';

const OPEN_METEO_INTERVAL_NAME = 'rainfall-hourly-ingestion';
const GSMAP_INTERVAL_NAME = 'rainfall-gsmap-ingestion';
const TERRAIN_INTERVAL_NAME = 'rainfall-terrain-sampling';
// How often the terrain sampler wakes up; how much it samples is capped by
// TERRAIN_SAMPLING_DISTRICTS_PER_DAY, so this only sets the granularity.
const TERRAIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Daily jobs: the Stage-2 spatial model is retrained (one more day of
// history barely moves the fit, and a replay of the 28-day window is ~670
// engine calls), and — Milestone 7 — DIBI labels (last two years) are
// refreshed, newly published archive days added and the hazard backtest
// re-run. "Due" is decided from the newest stored run of each task, checked
// hourly, so API restarts (deploys, `--watch`) no longer reset the 24 h clock.
const DAILY_JOBS_INTERVAL_NAME = 'rainfall-daily-jobs';
const DAILY_JOBS_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DAILY_JOB_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Runs Open-Meteo ingestion every RAINFALL_INGESTION_INTERVAL_MS and GSMaP
 * ingestion every GSMAP_INGESTION_INTERVAL_MS (0 disables either; GSMaP is
 * also skipped without FTP credentials). Same posture as
 * KarhutlaPredictionScheduler: no run on startup, so `nest start --watch`
 * restarts don't burn provider quota — both ingestions catch up on missed
 * hours by themselves. Operators can trigger runs manually.
 *
 * A rain nowcast, a flood-risk run and a landslide-risk run follow every
 * GSMaP run that stored a new rain field, so all start from the newest data
 * rather than on a separate, drifting clock. Without GSMaP, the risk runs
 * follow Open-Meteo runs instead.
 *
 * On startup, InaRISK flood susceptibility is sampled for districts that
 * have none (or a >30-day-old one) — a no-op once the table is filled, and
 * no provider quota is involved. DEM slope sampling also starts on startup
 * and every 6 h, but spends Open-Meteo quota, so it is capped per rolling
 * 24 h from the table itself (restarts cannot exceed the cap).
 *
 * The Stage-2 spatial nowcast model is retrained and re-evaluated daily;
 * live nowcasts use it only for horizons that passed its promotion gate.
 *
 * Daily: DIBI flood/landslide labels are refreshed, newly published
 * GSMaP_Gauge archive days are added (GSMAP_ARCHIVE_DAYS_PER_RUN) and the
 * hazard backtest is re-run.
 *
 * Both daily jobs are checked hourly (first check one hour after startup)
 * and run when their newest stored run is 24 h old or missing, so restarts
 * neither skip nor repeat them.
 */
@Injectable()
export class RainfallIngestionScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RainfallIngestionScheduler.name);
  private backtestRefreshing = false;

  constructor(
    private readonly openMeteo: RainfallIngestionService,
    private readonly gsmap: GsmapIngestionService,
    private readonly nowcast: RainfallNowcastService,
    private readonly floodRisk: RainfallFloodRiskService,
    private readonly hazardIndex: DistrictHazardIndexService,
    private readonly landslideRisk: RainfallLandslideRiskService,
    private readonly terrain: DistrictTerrainService,
    private readonly spatialModel: RainfallSpatialModelService,
    private readonly labels: DisasterLabelsService,
    private readonly archive: GsmapArchiveService,
    private readonly hazardBacktest: RainfallHazardBacktestService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    this.hazardIndex.startInBackground();
    this.terrain.startInBackground();
    const terrainInterval = setInterval(
      () => this.terrain.startInBackground(),
      TERRAIN_CHECK_INTERVAL_MS,
    );
    this.schedulerRegistry.addInterval(TERRAIN_INTERVAL_NAME, terrainInterval);
    const dailyJobsInterval = setInterval(
      () => void this.runDailyJobsIfDue(),
      DAILY_JOBS_CHECK_INTERVAL_MS,
    );
    this.schedulerRegistry.addInterval(
      DAILY_JOBS_INTERVAL_NAME,
      dailyJobsInterval,
    );
    const gsmapConfigured = this.gsmap.isConfigured();
    this.schedule(
      OPEN_METEO_INTERVAL_NAME,
      'RAINFALL_INGESTION_INTERVAL_MS',
      DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
      () =>
        gsmapConfigured
          ? this.openMeteo.ingest()
          : this.ingestOpenMeteoThenRiskRuns(),
    );
    if (!gsmapConfigured) {
      this.logger.log(
        'GSMaP ingestion disabled (GSMAP_FTP_USER/GSMAP_FTP_PASSWORD not set)',
      );
      return;
    }
    this.schedule(
      GSMAP_INTERVAL_NAME,
      'GSMAP_INGESTION_INTERVAL_MS',
      DEFAULT_GSMAP_INGESTION_INTERVAL_MS,
      () => this.ingestGsmapThenNowcast(),
    );
  }

  private async ingestGsmapThenNowcast() {
    const summary = await this.gsmap.ingest();
    if (summary && summary.gridsWritten > 0) {
      const run = await this.nowcast.run('scheduled');
      if (run) {
        this.logger.log(`Rain nowcast ${run.id}: ${run.status}`);
      }
      await this.runRiskBaselines();
    }
    return summary;
  }

  private async ingestOpenMeteoThenRiskRuns() {
    const summary = await this.openMeteo.ingest();
    if (summary) await this.runRiskBaselines();
    return summary;
  }

  private async runRiskBaselines() {
    const flood = await this.floodRisk.run('scheduled');
    if (flood) {
      this.logger.log(`Flood risk ${flood.id}: ${flood.status}`);
    }
    const landslide = await this.landslideRisk.run('scheduled');
    if (landslide) {
      this.logger.log(`Landslide risk ${landslide.id}: ${landslide.status}`);
    }
  }

  private async runDailyJobsIfDue() {
    try {
      if (isDue(await this.spatialModel.lastIssuedAt())) {
        this.spatialModel.startInBackground('scheduled');
      }
      if (isDue(await this.hazardBacktest.lastIssuedAt())) {
        await this.refreshBacktest();
      }
    } catch (error) {
      this.logger.error(
        `Scheduled daily rainfall jobs failed: ${(error as Error).message}`,
      );
    }
  }

  private async refreshBacktest() {
    // A refresh (labels + archive + backtest) can outlast the hourly check.
    if (this.backtestRefreshing) return;
    this.backtestRefreshing = true;
    try {
      const year = new Date().getUTCFullYear();
      await this.labels.import(
        Math.max(this.labels.fromYear(), year - 1),
        year,
      );
      const days = Number(this.config.get('GSMAP_ARCHIVE_DAYS_PER_RUN') ?? 4);
      if (days > 0 && this.archive.isConfigured()) {
        await this.archive.backfill({ maxDays: days });
      }
      await this.hazardBacktest.run('scheduled');
    } catch (error) {
      this.logger.error(
        `Scheduled hazard backtest refresh failed: ${(error as Error).message}`,
      );
    } finally {
      this.backtestRefreshing = false;
    }
  }

  onModuleDestroy() {
    for (const name of [
      OPEN_METEO_INTERVAL_NAME,
      GSMAP_INTERVAL_NAME,
      TERRAIN_INTERVAL_NAME,
      DAILY_JOBS_INTERVAL_NAME,
    ]) {
      if (this.schedulerRegistry.doesExist('interval', name)) {
        this.schedulerRegistry.deleteInterval(name);
      }
    }
  }

  private schedule(
    name: string,
    envVar: string,
    defaultMs: number,
    run: () => Promise<unknown>,
  ) {
    const intervalMs = Number(this.config.get(envVar) ?? defaultMs);
    if (!intervalMs) {
      this.logger.log(`Scheduled ${name} disabled (${envVar}=0)`);
      return;
    }
    const interval = setInterval(() => void this.tick(name, run), intervalMs);
    this.schedulerRegistry.addInterval(name, interval);
    this.logger.log(`${name} scheduled every ${intervalMs}ms`);
  }

  private async tick(name: string, run: () => Promise<unknown>) {
    try {
      const summary = await run();
      if (!summary) {
        this.logger.debug(`${name} still running — tick skipped`);
      }
    } catch (error) {
      this.logger.error(
        `Scheduled ${name} failed: ${(error as Error).message}`,
      );
    }
  }
}

/** True when a daily job has never run or last ran at least 24 h ago. */
function isDue(lastIssuedAt: Date | null, now: Date = new Date()): boolean {
  return (
    !lastIssuedAt ||
    now.getTime() - lastIssuedAt.getTime() >= DAILY_JOB_PERIOD_MS
  );
}
