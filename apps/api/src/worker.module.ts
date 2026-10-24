import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { VillagePopulationImportModule } from './village-population-import/village-population-import.module';
import { KarhutlaPipelineModule } from './karhutla-prediction/karhutla-pipeline.module';

/**
 * The worker process's OWN root module — deliberately NOT `AppModule`.
 *
 * `worker.ts` originally booted `AppModule` via
 * `NestFactory.createApplicationContext`, on the reasoning that reusing
 * the exact same dependency graph as the HTTP API was simplest. Verified
 * live (100k-row e2e test) that this was wrong: `AppModule` also wires up
 * every OTHER scheduled background service in the app —
 * `IngestionScheduler` (BMKG/weather/landslide-trigger/PetaBencana/NASA
 * FIRMS polling), `RiskEngineOrchestrationService`, `NotificationsService`,
 * etc. — none of which have anything to do with BullMQ job processing.
 * Running the worker process against full `AppModule` meant those
 * unrelated cron jobs ran a SECOND time (once in the API process, once in
 * the worker process), competing for the same Postgres connection pool as
 * the actual import job — and a pre-existing concurrency issue in that
 * unrelated code (a `client.query() called while already executing a
 * query` condition, observed in the worker's own log) stalled the import
 * job mid-run with no crash and no forward progress. That is a real,
 * observed way the worker's own boot choice blocked this feature's import
 * flow, not a hypothetical — hence fixing the boot module, without
 * touching the unrelated scheduler/risk-engine code that has the
 * underlying bug (out of scope per this session's instructions unless it
 * blocks this feature, which the full-`AppModule` boot choice did).
 *
 * This module wires up exactly what `ValidationProcessor`/`ImportProcessor`
 * need: the Postgres connection (`DatabaseModule`), the BullMQ connection
 * and queue registrations + the processors themselves
 * (`VillagePopulationImportModule`), and object storage for the uploaded
 * CSV (`StorageModule`, `@Global()` so importing it once here is enough).
 * Nothing else in `AppModule` — no controllers, no schedulers, no
 * unrelated feature modules — is loaded in this process.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    DatabaseModule,
    QueueModule,
    StorageModule,
    VillagePopulationImportModule,
    // Karhutla prediction jobs (queue consumer + pipeline only — no
    // controllers or schedulers, which stay in the API process).
    KarhutlaPipelineModule,
  ],
})
export class WorkerModule {}
