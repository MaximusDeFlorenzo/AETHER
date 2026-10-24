import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { HazardEvent, KarhutlaPredictionRun } from '../database/entities';
import { AuditModule } from '../audit/audit.module';
import { KARHUTLA_PREDICTION_QUEUE } from './karhutla.constants';
import { KarhutlaPredictionController } from './karhutla-prediction.controller';
import { KarhutlaPredictionService } from './karhutla-prediction.service';
import { KarhutlaPredictionScheduler } from './karhutla-prediction.scheduler';
import { KarhutlaPipelineModule } from './karhutla-pipeline.module';

/** API side of karhutla predictions: REST endpoints, run lifecycle and the
 * scheduled trigger. Job execution lives in KarhutlaPipelineModule. */
@Module({
  imports: [
    TypeOrmModule.forFeature([KarhutlaPredictionRun, HazardEvent]),
    BullModule.registerQueue({ name: KARHUTLA_PREDICTION_QUEUE }),
    AuditModule,
    KarhutlaPipelineModule,
  ],
  controllers: [KarhutlaPredictionController],
  providers: [KarhutlaPredictionService, KarhutlaPredictionScheduler],
})
export class KarhutlaPredictionModule {}
