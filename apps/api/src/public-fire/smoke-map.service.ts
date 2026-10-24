import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KarhutlaPredictionRun } from '../database/entities';
import { KarhutlaRunStatus } from '../karhutla-prediction/karhutla.enums';
import type { SmokeHorizonResult } from '../karhutla-prediction/karhutla.types';
import { CacheService } from '../redis/cache.service';
import { HotspotMapService } from './hotspot-map.service';
import {
  toPublicSmokeForecast,
  type ForecastInput,
  type PublicSmokeForecast,
} from './smoke-map';

const CACHE_KEY = 'public:smoke:latest-run';
const CACHE_TTL_SECONDS = 120;
// Matches the operator page's OUTDATED_AFTER_HOURS: past this the portal
// falls back to its simple wind-drift plumes instead of a stale model run.
export const SMOKE_STALE_AFTER_HOURS = 6;

interface CachedRun {
  id: string;
  issuedAt: string;
  completedAt: string | null;
  horizonsHours: number[];
  modelVersion: string | null;
  method: string | null;
  limitations: string[];
  forecasts: Array<
    Omit<ForecastInput, 'latestObservedAt'> & { latestObservedAt: string }
  >;
}

export interface PublicSmokeResponse {
  run: {
    id: string;
    issuedAt: string;
    completedAt: string | null;
    horizonsHours: number[];
    ageHours: number;
    stale: boolean;
    modelVersion: string | null;
    method: string | null;
    limitations: string[];
  } | null;
  displayHours: number;
  targetAt: string;
  forecasts: PublicSmokeForecast[];
}

/** The latest finished karhutla run's smoke, trimmed for the citizen map. */
@Injectable()
export class SmokeMapService {
  constructor(
    @InjectRepository(KarhutlaPredictionRun)
    private readonly runRepository: Repository<KarhutlaPredictionRun>,
    private readonly hotspotMapService: HotspotMapService,
    private readonly cache: CacheService,
  ) {}

  async getLatest(
    displayHours: number,
    citizen?: { latitude: number; longitude: number },
  ): Promise<PublicSmokeResponse> {
    const now = new Date();
    const targetAt = new Date(now.getTime() + displayHours * 3_600_000);
    const run = await this.cache.getOrSet(CACHE_KEY, CACHE_TTL_SECONDS, () =>
      this.loadLatestRun(),
    );
    if (!run) {
      return {
        run: null,
        displayHours,
        targetAt: targetAt.toISOString(),
        forecasts: [],
      };
    }

    const { clusters } = await this.hotspotMapService.getFullMap(24);
    const ageHours =
      (now.getTime() - new Date(run.issuedAt).getTime()) / 3_600_000;
    return {
      run: {
        id: run.id,
        issuedAt: run.issuedAt,
        completedAt: run.completedAt,
        horizonsHours: run.horizonsHours,
        ageHours: Number(ageHours.toFixed(1)),
        stale: ageHours > SMOKE_STALE_AFTER_HOURS,
        modelVersion: run.modelVersion,
        method: run.method,
        limitations: run.limitations,
      },
      displayHours,
      targetAt: targetAt.toISOString(),
      forecasts: run.forecasts.map((forecast) =>
        toPublicSmokeForecast(
          {
            ...forecast,
            latestObservedAt: new Date(forecast.latestObservedAt),
          },
          clusters,
          now,
          targetAt,
          citizen,
        ),
      ),
    };
  }

  private async loadLatestRun(): Promise<CachedRun | null> {
    const run = await this.runRepository.findOne({
      where: {
        status: In([KarhutlaRunStatus.COMPLETED, KarhutlaRunStatus.PARTIAL]),
      },
      relations: { forecasts: { nearestDistrict: true } },
      order: { createdAt: 'DESC' },
    });
    if (!run?.issuedAt) return null;

    const forecasts = [...(run.forecasts ?? [])].sort(
      (a, b) => a.rank - b.rank,
    );
    const smokeMeta = forecasts.find((f) => f.smoke)?.smoke as {
      modelVersion?: string;
      method?: string;
      limitations?: string[];
    } | null;
    return {
      id: run.id,
      issuedAt: run.issuedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      horizonsHours: run.horizonsHours,
      modelVersion: smokeMeta?.modelVersion ?? null,
      method: smokeMeta?.method ?? null,
      limitations: smokeMeta?.limitations ?? [],
      forecasts: forecasts.map((f) => ({
        id: f.id,
        rank: f.rank,
        latitude: f.latitude,
        longitude: f.longitude,
        nearestDistrictName: f.nearestDistrict?.name ?? null,
        confidence: f.confidence,
        latestObservedAt: f.latestObservedAt.toISOString(),
        hotspotEventIds: f.hotspotEventIds,
        dataQuality: f.dataQuality,
        smoke: f.smoke as { horizons?: SmokeHorizonResult[] } | null,
      })),
    };
  }
}
