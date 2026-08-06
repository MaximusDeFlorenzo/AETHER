import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { DetectCvRequest, DetectCvResponse } from './cv-engine.types';

/**
 * Internal client for apps/ai-engine's Computer Vision Engine (`/detect-cv`)
 * — same internal-REST-with-static-token-header pattern as
 * `RiskEngineClient`, kept as a separate class since it's a different engine
 * with a very different payload shape (a base64 image, not hazard/district
 * data) and a longer timeout (image decode + four color/texture detectors).
 */
@Injectable()
export class CvEngineClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('AI_ENGINE_URL')!;
  }

  private get headers() {
    return {
      'X-Internal-Token': this.config.get<string>('INTERNAL_SERVICE_TOKEN'),
    };
  }

  async detectCv(payload: DetectCvRequest): Promise<DetectCvResponse> {
    const { data } = await firstValueFrom(
      this.http.post<DetectCvResponse>(`${this.baseUrl}/detect-cv`, payload, {
        headers: this.headers,
        timeout: 20_000,
      }),
    );
    return data;
  }
}
