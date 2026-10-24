import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import {
  District,
  HazardEvent,
  KarhutlaClusterForecast,
  KarhutlaPredictionRun,
} from '../database/entities';
import { KARHUTLA_PREDICTION_QUEUE } from './karhutla.constants';
import { KarhutlaPipelineService } from './karhutla-pipeline.service';
import { KarhutlaPredictionProcessor } from './karhutla-prediction.processor';
import { KarhutlaEngineClient } from './karhutla-engine.client';
import { OpenMeteoAtmosphereProvider } from './providers/open-meteo-atmosphere.provider';
import { TerrainProvider } from './providers/terrain.provider';
import { SettlementsProvider } from './providers/settlements.provider';

// Same ENABLE_JOB_PROCESSORS convention as village-population-import.module.ts
// (read from the real OS env, before ConfigModule exists).
const jobProcessors =
  process.env.ENABLE_JOB_PROCESSORS === 'false'
    ? []
    : [KarhutlaPredictionProcessor];

/**
 * The job-processing half of karhutla predictions: queue consumer, pipeline,
 * data providers and AI-engine client. Imported by KarhutlaPredictionModule
 * (API process) AND by WorkerModule, so a separately deployed worker
 * (`worker.ts`, see README-worker.md) processes karhutla jobs too. No
 * controllers or schedulers here — WorkerModule has no ScheduleModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KarhutlaPredictionRun,
      KarhutlaClusterForecast,
      HazardEvent,
      District,
    ]),
    BullModule.registerQueue({ name: KARHUTLA_PREDICTION_QUEUE }),
    HttpModule,
  ],
  providers: [
    KarhutlaPipelineService,
    KarhutlaEngineClient,
    OpenMeteoAtmosphereProvider,
    TerrainProvider,
    SettlementsProvider,
    ...jobProcessors,
  ],
})
export class KarhutlaPipelineModule {}
