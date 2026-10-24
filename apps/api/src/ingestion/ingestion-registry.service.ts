import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { HazardEventsService } from '../hazard-events/hazard-events.service';
import { DataSourceSyncService } from './data-source-sync.service';
import type { IngestedHazardEvent } from '../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './adapters/hazard-data-source-adapter.interface';
import { HAZARD_DATA_SOURCE_ADAPTERS } from './ingestion.constants';

export interface SyncResult {
  newEventsIngested: number;
  eventsFetched: number;
}

/**
 * Simple in-memory registry (Map keyed by `sourceId`) any
 * `HazardDataSourceAdapter` is registered into via the
 * `HAZARD_DATA_SOURCE_ADAPTERS` multi-provider token in `ingestion.module.ts`
 * — no adapter-specific branching here, so adding a new source means
 * implementing the interface and adding it to that provider array, nothing
 * else (see `weather.adapter.ts`/`nasa-firms.adapter.ts`/`sentinel.adapter.ts`).
 */
@Injectable()
export class IngestionRegistryService {
  private readonly logger = new Logger(IngestionRegistryService.name);
  private readonly adaptersBySourceId = new Map<
    string,
    HazardDataSourceAdapter
  >();

  constructor(
    @Inject(HAZARD_DATA_SOURCE_ADAPTERS)
    adapters: HazardDataSourceAdapter[],
    @Inject(forwardRef(() => HazardEventsService))
    private readonly hazardEventsService: HazardEventsService,
    private readonly dataSourceSyncService: DataSourceSyncService,
  ) {
    for (const adapter of adapters) {
      this.adaptersBySourceId.set(adapter.sourceId, adapter);
    }
  }

  listSourceIds(): string[] {
    return [...this.adaptersBySourceId.keys()];
  }

  async triggerSync(sourceId: string): Promise<SyncResult> {
    const adapter = this.adaptersBySourceId.get(sourceId);
    if (!adapter) {
      throw new Error(`Unknown ingestion source: ${sourceId}`);
    }

    try {
      const rawEvents = await adapter.fetch();
      let ingested = 0;
      if (adapter.producesHazardEvents ?? true) {
        if (adapter.selectAnnouncements) {
          const newEvents: IngestedHazardEvent[] = [];
          for (const raw of rawEvents) {
            const result =
              await this.hazardEventsService.ingestEventWithoutAnnouncing(
                adapter.normalize(raw),
              );
            if (result) newEvents.push(result);
          }
          ingested = newEvents.length;
          if (newEvents.length > 0) {
            const announcements = await adapter.selectAnnouncements(newEvents);
            for (const announcement of announcements) {
              this.hazardEventsService.announce(announcement);
            }
            this.logger.log(
              `Source=${sourceId} ingested ${newEvents.length} new event(s), ` +
                `announced ${announcements.length}`,
            );
          }
        } else {
          for (const raw of rawEvents) {
            const normalized = adapter.normalize(raw);
            const result =
              await this.hazardEventsService.ingestEvent(normalized);
            if (result) ingested += 1;
          }
        }
      } else if (rawEvents.length > 0) {
        this.logger.debug(
          `Source=${sourceId} fetched ${rawEvents.length} record(s); ` +
            'producesHazardEvents=false, skipping hazard-event ingestion',
        );
      }
      await this.dataSourceSyncService.recordSuccess(sourceId);
      return { newEventsIngested: ingested, eventsFetched: rawEvents.length };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Sync failed for source=${sourceId}: ${message}`);
      await this.dataSourceSyncService.recordFailure(sourceId, message);
      throw error;
    }
  }
}
