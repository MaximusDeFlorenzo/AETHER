import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HazardEvent } from '../database/entities';

const FIRMS_SOURCE = 'nasa_firms';
// Small batches keep each DELETE (plus its cascades into wildfire_details
// and hazard_affected_regions) short — no long locks, little memory.
export const RETENTION_BATCH_SIZE = 5000;
// ~12k detections/day: 200 batches clears ~80 days of backlog in one run.
const MAX_BATCHES_PER_RUN = 200;

// Detections any of these still point at are kept: every FK to
// hazard_events is ON DELETE CASCADE, so deleting the detection would also
// delete the risk assessment / notification / plan built on it.
const STILL_REFERENCED = [
  'SELECT 1 FROM risk_assessments r WHERE r.hazard_event_id = e.id',
  'SELECT 1 FROM notifications n WHERE n.related_hazard_event_id = e.id',
  'SELECT 1 FROM resource_optimization_plans p WHERE p.hazard_event_id = e.id',
  'SELECT 1 FROM hazard_relationships h WHERE h.source_event_id = e.id OR h.related_event_id = e.id',
  'SELECT 1 FROM cv_detections c WHERE c.hazard_event_id = e.id',
  'SELECT 1 FROM public_alerts a WHERE a.hazard_event_id = e.id',
];

/**
 * Deletes NASA FIRMS hotspot detections older than `HOTSPOT_RETENTION_DAYS`
 * (default 90; 0 disables) once a day. MODIS + VIIRS add ~12k rows/day, so
 * without this `hazard_events` grows ~3.5–4 GB a year; with it the table
 * levels off (Postgres reuses the freed space after autovacuum — the files
 * don't shrink, they stop growing).
 *
 * Only unreferenced detections go: one that triggered a risk assessment,
 * notification, resource plan, hazard relationship, CV detection or public
 * alert is kept, whatever its age. Old karhutla forecasts keep their
 * `hotspotEventIds`; the deleted ones simply no longer resolve on the map.
 */
@Injectable()
export class HotspotRetentionService {
  private readonly logger = new Logger(HotspotRetentionService.name);
  private running = false;

  constructor(
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledPurge(): Promise<void> {
    try {
      await this.purge();
    } catch (error) {
      this.logger.error(
        `Hotspot retention purge failed: ${(error as Error).message}`,
      );
    }
  }

  async purge(
    now = new Date(),
  ): Promise<{ deleted: number; cutoff: Date | null }> {
    const days = this.config.get<number>('HOTSPOT_RETENTION_DAYS') ?? 90;
    if (days <= 0) return { deleted: 0, cutoff: null };
    // A run can take a while on a large backlog; never overlap two.
    if (this.running) return { deleted: 0, cutoff: null };
    this.running = true;

    const cutoff = new Date(now.getTime() - days * 86_400_000);
    let deleted = 0;
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
        const result = await this.hazardEventRepository
          .createQueryBuilder()
          .delete()
          .from(HazardEvent)
          .where(
            `id IN (
              SELECT e.id FROM hazard_events e
              WHERE e.source = :source AND e.event_time < :cutoff
              ${STILL_REFERENCED.map((q) => `AND NOT EXISTS (${q})`).join('\n')}
              LIMIT :limit
            )`,
            { source: FIRMS_SOURCE, cutoff, limit: RETENTION_BATCH_SIZE },
          )
          .execute();
        const affected = result.affected ?? 0;
        deleted += affected;
        if (affected < RETENTION_BATCH_SIZE) break;
      }
    } finally {
      this.running = false;
    }

    if (deleted > 0) {
      this.logger.log(
        `Deleted ${deleted} FIRMS hotspot(s) observed before ${cutoff.toISOString()} (retention ${days} d)`,
      );
    }
    return { deleted, cutoff };
  }
}
