import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly http: HttpHealthIndicator,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      async () => {
        const pong = await this.redis.ping();
        return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
      },
      () =>
        this.http.pingCheck(
          'aiEngine',
          `${this.config.get<string>('AI_ENGINE_URL')}/health`,
        ),
    ]);
  }
}
