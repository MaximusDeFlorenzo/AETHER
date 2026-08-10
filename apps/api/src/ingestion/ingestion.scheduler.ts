import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { IngestionRegistryService } from './ingestion-registry.service';

// Per-source poll interval lookup.
const POLL_INTERVAL_ENV_BY_SOURCE: Record<string, string> = {
  bmkg: 'BMKG_POLL_INTERVAL_MS',
  nasa_firms: 'NASA_FIRMS_POLL_INTERVAL_MS',
  weather_api: 'WEATHER_POLL_INTERVAL_MS',
  petabencana: 'PETABENCANA_POLL_INTERVAL_MS',
  landslide_rainfall_trigger: 'LANDSLIDE_TRIGGER_POLL_INTERVAL_MS',
  sentinel: 'SENTINEL_POLL_INTERVAL_MS',
};
const DEFAULT_POLL_INTERVAL_MS = 300_000;

/**
 * Generalizes ORION's `earthquakes.scheduler.ts` @nestjs/schedule wiring —
 * one interval per registered adapter instead of one hardcoded BMKG poll.
 */
@Injectable()
export class IngestionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionScheduler.name);
  private readonly intervalNames: string[] = [];

  constructor(
    private readonly ingestionRegistryService: IngestionRegistryService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    for (const sourceId of this.ingestionRegistryService.listSourceIds()) {
      const envVar = POLL_INTERVAL_ENV_BY_SOURCE[sourceId];
      const intervalMs = envVar
        ? (this.config.get<number>(envVar) ?? DEFAULT_POLL_INTERVAL_MS)
        : DEFAULT_POLL_INTERVAL_MS;

      const intervalName = `ingestion-poll-${sourceId}`;
      const interval = setInterval(() => {
        void this.poll(sourceId);
      }, intervalMs);
      this.schedulerRegistry.addInterval(intervalName, interval);
      this.intervalNames.push(intervalName);
      this.logger.log(
        `Ingestion polling scheduled for source=${sourceId} every ${intervalMs}ms`,
      );

      // Immediate poll on startup so the dashboard isn't empty while
      // waiting for the first interval to elapse.
      void this.poll(sourceId);
    }
  }

  onModuleDestroy() {
    for (const name of this.intervalNames) {
      if (this.schedulerRegistry.doesExist('interval', name)) {
        this.schedulerRegistry.deleteInterval(name);
      }
    }
  }

  private async poll(sourceId: string): Promise<void> {
    try {
      const { newEventsIngested } =
        await this.ingestionRegistryService.triggerSync(sourceId);
      if (newEventsIngested > 0) {
        this.logger.log(
          `Ingestion poll for ${sourceId} ingested ${newEventsIngested} new event(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Ingestion poll failed for ${sourceId}: ${(error as Error).message}`,
      );
    }
  }
}
