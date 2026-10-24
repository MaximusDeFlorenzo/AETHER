import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { KARHUTLA_PREDICTION_QUEUE } from './karhutla.constants';
import { KarhutlaPipelineService } from './karhutla-pipeline.service';
import type { KarhutlaJobPayload } from './karhutla-prediction.service';

/** Runs prediction jobs off the HTTP request path. Concurrency 1: runs are
 * serialized anyway (single active run), and this keeps load on the AI
 * engine and on Open-Meteo/Overpass predictable. */
@Processor(KARHUTLA_PREDICTION_QUEUE, { concurrency: 1 })
export class KarhutlaPredictionProcessor extends WorkerHost {
  private readonly logger = new Logger(KarhutlaPredictionProcessor.name);

  constructor(private readonly pipeline: KarhutlaPipelineService) {
    super();
  }

  async process(job: Job<KarhutlaJobPayload>): Promise<void> {
    await this.pipeline.execute(job.data.runId);
  }

  // Fires on every failed attempt; only the last one finalizes the run so
  // BullMQ's retry still gets its chance.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<KarhutlaJobPayload> | undefined, error: Error) {
    if (!job) return;
    this.logger.error(
      `Karhutla run ${job.data.runId} attempt ${job.attemptsMade} failed: ${error.message}`,
    );
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.pipeline.markFailed(job.data.runId, error.message);
    }
  }
}
