import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

/**
 * Standalone process for BullMQ job processing (currently: the
 * village-population-import validation and confirm/import queues — see
 * `queue/queue.module.ts`). Boots `WorkerModule` — deliberately NOT
 * `AppModule` (see `worker.module.ts`'s comment for why: booting the full
 * app here also ran every unrelated scheduled service a second time and
 * was observed live to stall an import job via connection-pool
 * contention) — with no HTTP listener.
 *
 * Running `pnpm run start:dev` (main.ts, `AppModule`) ALSO runs every
 * `@Processor` in-process; that's sufficient for local development with a
 * single process. This entrypoint exists for running the worker as its
 * own deployable process — so a worker crash/restart never drops an
 * in-flight HTTP request, and an API deploy/restart never aborts an
 * in-flight 100k-row import (it resumes from its checkpoint on the next
 * worker that picks the job up regardless of which process that is). See
 * README-worker.md for how to run this and what it needs.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  const logger = new Logger('Worker');
  logger.log(
    'Worker process ready — BullMQ processors registered (village-population-import: validation, confirm/import)',
  );

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — closing worker process`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap();
