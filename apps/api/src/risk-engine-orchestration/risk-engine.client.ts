import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type {
  CalculatePriorityRequest,
  CalculatePriorityResponse,
  GenerateRecommendationRequest,
  GenerateRecommendationResponse,
  OptimizeResourcesRequest,
  OptimizeResourcesResponse,
  PredictRiskRequest,
  PredictRiskResponse,
} from './risk-engine.types';

/**
 * Redesign of ORION's `ai/ai.client.ts` — same internal-REST-with-static-
 * token-header call pattern (axios/HttpService, `X-Internal-Token`), now
 * hazard-agnostic (`hazardType` travels in every payload so apps/ai-engine's
 * routers can dispatch internally) instead of one earthquake-only client.
 */
@Injectable()
export class RiskEngineClient {
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

  async predictRisk(payload: PredictRiskRequest): Promise<PredictRiskResponse> {
    const { data } = await firstValueFrom(
      this.http.post<PredictRiskResponse>(
        `${this.baseUrl}/predict-risk`,
        payload,
        { headers: this.headers, timeout: 15_000 },
      ),
    );
    return data;
  }

  async calculatePriority(
    payload: CalculatePriorityRequest,
  ): Promise<CalculatePriorityResponse> {
    const { data } = await firstValueFrom(
      this.http.post<CalculatePriorityResponse>(
        `${this.baseUrl}/calculate-priority`,
        payload,
        { headers: this.headers, timeout: 15_000 },
      ),
    );
    return data;
  }

  async generateRecommendation(
    payload: GenerateRecommendationRequest,
  ): Promise<GenerateRecommendationResponse> {
    const { data } = await firstValueFrom(
      this.http.post<GenerateRecommendationResponse>(
        `${this.baseUrl}/generate-recommendation`,
        payload,
        { headers: this.headers, timeout: 15_000 },
      ),
    );
    return data;
  }

  // Called by resource-optimization/ once a decision recommendation's
  // priority crosses RISK_NOTIFICATION_THRESHOLD, not by this module.
  async optimizeResources(
    payload: OptimizeResourcesRequest,
  ): Promise<OptimizeResourcesResponse> {
    const { data } = await firstValueFrom(
      this.http.post<OptimizeResourcesResponse>(
        `${this.baseUrl}/optimize-resources`,
        payload,
        { headers: this.headers, timeout: 15_000 },
      ),
    );
    return data;
  }
}
