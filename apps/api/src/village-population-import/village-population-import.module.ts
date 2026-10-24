import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import {
  Village,
  VillagePopulation,
  VillagePopulationImportBatch,
  VillagePopulationImportRow,
} from '../database/entities';
import { VillagePopulationImportService } from './village-population-import.service';
import { VillagePopulationImportController } from './village-population-import.controller';
import { ValidationProcessor } from './processors/validation.processor';
import { ImportProcessor } from './processors/import.processor';
import {
  VILLAGE_POPULATION_CONFIRM_QUEUE,
  VILLAGE_POPULATION_VALIDATION_QUEUE,
} from '../queue/queue.module';
import { AuditModule } from '../audit/audit.module';

// Set `ENABLE_JOB_PROCESSORS=false` on a process's real OS environment
// (not `.env` — this is read before Nest's ConfigModule/dotenv exists,
// same constraint as `@Processor()`'s own decorator-time evaluation) to
// run that process as API-only, never consuming BullMQ jobs itself. Lets
// `main.ts` (HTTP) and `worker.ts` (job processing) actually be scaled and
// restarted independently in production, e.g. `main.ts` for the API pods
// and a separate `worker.ts` deployment for job processing — and is what
// makes "kill the worker process, verify the API stays responsive, then
// restart the worker and see it resume" a meaningful test rather than
// both roles always living in the same process. Defaults to enabled: a
// single `start:dev` process running both is still the normal, supported
// local-dev setup (see README-worker.md).
const jobProcessors =
  process.env.ENABLE_JOB_PROCESSORS === 'false'
    ? []
    : [ValidationProcessor, ImportProcessor];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Village,
      VillagePopulation,
      VillagePopulationImportBatch,
      VillagePopulationImportRow,
    ]),
    // Connection itself comes from QueueModule (global); a feature module
    // only needs to register the named queues it produces to / consumes
    // from.
    BullModule.registerQueue(
      { name: VILLAGE_POPULATION_VALIDATION_QUEUE },
      { name: VILLAGE_POPULATION_CONFIRM_QUEUE },
    ),
    // StorageService is @Global() and doesn't need importing (same
    // convention field-reports.module.ts uses).
    AuditModule,
  ],
  controllers: [VillagePopulationImportController],
  providers: [VillagePopulationImportService, ...jobProcessors],
})
export class VillagePopulationImportModule {}
