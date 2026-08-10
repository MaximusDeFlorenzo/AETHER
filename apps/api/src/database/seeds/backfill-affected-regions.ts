/**
 * One-off backfill: re-resolves `hazard_affected_regions` (and re-runs risk
 * scoring) for every existing `hazard_events` row against the full 514-
 * district seed (`reference-data.seed.ts`). Needed because most real events
 * ingested while only 11 demo districts existed resolved to zero affected
 * districts and never got scored — see `SpatialIntelligenceService
 * .resolveAffectedRegions()`'s own "seed data may not cover this region"
 * warning. Not part of the regular seed path (`run-seed.ts`): this is a
 * one-time migration step, safe to delete once run in each environment that
 * needs it. Skips events that already have at least one affected region
 * (defensive — `resolveAffectedRegions` itself has no idempotency check, but
 * the DB's unique (hazard_event_id, district_id) constraint would reject a
 * true duplicate anyway).
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../../app.module';
import {
  EarthquakeDetails,
  HazardAffectedRegion,
  HazardEvent,
} from '../entities';
import { HazardType } from '../../common/enums/domain.enum';
import { SpatialIntelligenceService } from '../../spatial-intelligence/spatial-intelligence.service';
import { RiskEngineOrchestrationService } from '../../risk-engine-orchestration/risk-engine-orchestration.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const hazardEventRepo = app.get<Repository<HazardEvent>>(
    getRepositoryToken(HazardEvent),
  );
  const earthquakeDetailsRepo = app.get<Repository<EarthquakeDetails>>(
    getRepositoryToken(EarthquakeDetails),
  );
  const affectedRegionRepo = app.get<Repository<HazardAffectedRegion>>(
    getRepositoryToken(HazardAffectedRegion),
  );
  const spatialService = app.get(SpatialIntelligenceService);
  const orchestrationService = app.get(RiskEngineOrchestrationService);

  const events = await hazardEventRepo.find();
  console.log(
    `Reprocessing ${events.length} hazard events against full district coverage...`,
  );

  let resolved = 0;
  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const existingCount = await affectedRegionRepo.count({
        where: { hazardEvent: { id: event.id } },
      });
      if (existingCount > 0) {
        skipped++;
        continue;
      }

      let severityMagnitude: number | null = null;
      if (event.hazardType === HazardType.EARTHQUAKE) {
        const details = await earthquakeDetailsRepo.findOne({
          where: { hazardEventId: event.id },
        });
        severityMagnitude = details?.magnitude ?? null;
      }

      const affectedDistrictIds = await spatialService.resolveAffectedRegions(
        event,
        severityMagnitude,
      );

      if (affectedDistrictIds.length > 0) {
        resolved++;
        await orchestrationService.runPipelineForHazardEvent(event.id);
        scored++;
      }
    } catch (error) {
      failed++;
      console.error(
        `Failed to reprocess event ${event.id}: ${(error as Error).message}`,
      );
    }
  }

  console.log(
    `Done. ${resolved}/${events.length} events now have at least one affected district ` +
      `(${scored} sent through risk scoring, ${skipped} already had regions, ${failed} failed).`,
  );

  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
