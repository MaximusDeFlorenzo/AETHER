import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { KarhutlaRunTrigger } from './karhutla.enums';
import { KarhutlaPredictionService } from './karhutla-prediction.service';

const INTERVAL_NAME = 'karhutla-prediction-run';
const CATCH_UP_TIMEOUT_NAME = 'karhutla-prediction-catch-up';
// Lets the app finish booting (and a burst of watch restarts settle) first.
const CATCH_UP_DELAY_MS = 60_000;

/**
 * Queues a scheduled run every KARHUTLA_PREDICTION_INTERVAL_MS (0 disables).
 * The interval restarts with the process, so frequent restarts (`nest start
 * --watch`, deploys) used to starve it and leave the forecast hours stale.
 * One catch-up check runs shortly after startup instead: it queues a run
 * only when the newest one is already older than the interval, so restarts
 * still never cost more than one run per interval of Open-Meteo/Overpass
 * quota. Overlapping ticks are harmless: requestRun() deduplicates.
 */
@Injectable()
export class KarhutlaPredictionScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KarhutlaPredictionScheduler.name);

  constructor(
    private readonly service: KarhutlaPredictionService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const intervalMs = Number(
      this.config.get('KARHUTLA_PREDICTION_INTERVAL_MS') ?? 10_800_000,
    );
    if (!intervalMs) {
      this.logger.log(
        'Scheduled karhutla predictions disabled (KARHUTLA_PREDICTION_INTERVAL_MS=0)',
      );
      return;
    }
    const interval = setInterval(() => void this.tick(), intervalMs);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, interval);
    this.logger.log(`Karhutla predictions scheduled every ${intervalMs}ms`);

    const catchUp = setTimeout(
      () => void this.catchUp(intervalMs),
      CATCH_UP_DELAY_MS,
    );
    this.schedulerRegistry.addTimeout(CATCH_UP_TIMEOUT_NAME, catchUp);
  }

  onModuleDestroy() {
    if (this.schedulerRegistry.doesExist('interval', INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
    if (this.schedulerRegistry.doesExist('timeout', CATCH_UP_TIMEOUT_NAME)) {
      this.schedulerRegistry.deleteTimeout(CATCH_UP_TIMEOUT_NAME);
    }
  }

  /** Queues a run if the newest one (any status) is older than the interval. */
  async catchUp(intervalMs: number, now = new Date()): Promise<void> {
    try {
      const [latest] = await this.service.listRuns(1);
      const age = latest
        ? now.getTime() - new Date(latest.createdAt).getTime()
        : Infinity;
      if (age < intervalMs) return;
      this.logger.log(
        latest
          ? `Last karhutla run is ${Math.round(age / 60_000)} min old; catching up`
          : 'No karhutla run yet; catching up',
      );
      await this.tick();
    } catch (error) {
      this.logger.error(
        `Karhutla catch-up check failed: ${(error as Error).message}`,
      );
    }
  }

  private async tick() {
    try {
      const { run, deduplicated } = await this.service.requestRun({
        trigger: KarhutlaRunTrigger.SCHEDULED,
      });
      if (!deduplicated)
        this.logger.log(`Queued scheduled karhutla run ${run.id}`);
    } catch (error) {
      this.logger.error(
        `Could not queue scheduled karhutla run: ${(error as Error).message}`,
      );
    }
  }
}
