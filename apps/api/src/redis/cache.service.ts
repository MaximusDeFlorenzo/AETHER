import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

const KEY_PREFIX = 'aether:cache:';

/**
 * Thin read-through cache over Redis for expensive aggregate queries and
 * near-static reference data. Callers pick their own TTL and, where
 * freshness matters (dashboard summary), invalidate explicitly on the
 * relevant domain event rather than relying on TTL alone.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = KEY_PREFIX + key;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      this.logger.warn(
        `Cache read failed for ${cacheKey}: ${(error as Error).message}`,
      );
    }

    const value = await load();

    try {
      await this.redis.set(cacheKey, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `Cache write failed for ${cacheKey}: ${(error as Error).message}`,
      );
    }

    return value;
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + key).catch((error: Error) => {
      this.logger.warn(
        `Cache invalidation failed for ${key}: ${error.message}`,
      );
    });
  }

  async invalidatePattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(KEY_PREFIX + pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys).catch((error: Error) => {
        this.logger.warn(
          `Cache pattern invalidation failed for ${pattern}: ${error.message}`,
        );
      });
    }
  }
}
