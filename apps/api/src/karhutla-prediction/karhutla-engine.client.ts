import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { withRetry } from './providers/retry';
import type {
  FireSpreadRequest,
  FireSpreadResponse,
  SmokeTransportRequest,
  SmokeTransportResponse,
} from './karhutla.types';

// Generous next to RiskEngineClient's 15 s: these are CPU-bound numerical
// runs, and they only ever execute inside a background job.
const ENGINE_TIMEOUT_MS = 45_000;
// One retry on timeouts / network errors / 5xx. The scheduled job often
// runs during a brief macOS DarkWake: the request goes out, the machine
// sleeps, and the timeout fires on the next wake — when a retry succeeds.
// Engine 422s (conflicting inputs) are not retried.
const ENGINE_ATTEMPTS = 2;

/** Same internal-REST + `X-Internal-Token` pattern as RiskEngineClient. */
@Injectable()
export class KarhutlaEngineClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private post<T>(path: string, payload: unknown): Promise<T> {
    return withRetry(
      () =>
        firstValueFrom(
          this.http.post<T>(
            `${this.config.get<string>('AI_ENGINE_URL')}${path}`,
            payload,
            {
              headers: {
                'X-Internal-Token': this.config.get<string>(
                  'INTERNAL_SERVICE_TOKEN',
                ),
              },
              timeout: ENGINE_TIMEOUT_MS,
            },
          ),
        ),
      { attempts: ENGINE_ATTEMPTS },
    ).then((response) => response.data);
  }

  predictFireSpread(payload: FireSpreadRequest): Promise<FireSpreadResponse> {
    return this.post('/predict-fire-spread', payload);
  }

  predictSmokeTransport(
    payload: SmokeTransportRequest,
  ): Promise<SmokeTransportResponse> {
    return this.post('/predict-smoke-transport', payload);
  }
}
