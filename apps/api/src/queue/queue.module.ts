import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const VILLAGE_POPULATION_VALIDATION_QUEUE =
  'village-population-validation';
export const VILLAGE_POPULATION_CONFIRM_QUEUE = 'village-population-confirm';

/**
 * Global BullMQ connection — reuses the same Redis instance as
 * `RedisModule`/`CacheService` (`REDIS_URL`, already provisioned in
 * `infra/docker-compose.yml` and required by env.validation.ts; no new
 * infra to stand up), but with its OWN dedicated ioredis connection rather
 * than sharing `CacheService`'s: BullMQ's blocking commands
 * (BRPOPLPUSH-style) are incompatible with a connection also used for
 * ordinary GET/SET traffic, and `maxRetriesPerRequest: null` (required by
 * BullMQ — it manages its own retry/backoff for blocking calls) would be
 * the wrong setting for CacheService's own connection.
 *
 * Registered once, globally, here — feature modules only need
 * `BullModule.registerQueue({ name: ... })`, never their own connection
 * config. See `apps/api/README-worker.md` (added alongside this feature)
 * for how to run job processing as a separate deployable process instead of
 * in-process with the API.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = new URL(config.get<string>('REDIS_URL')!);
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            password: redisUrl.password || undefined,
            db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1)) || 0 : 0,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
