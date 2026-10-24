import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  RainfallGrid,
  WeatherHourlySample,
} from '../database/entities';
import { GRID_PRODUCT } from './gsmap-ingestion.service';
import {
  DirectionScore,
  domainCell,
  ProbabilisticScore,
} from './lib/verification';
import { towardDeg } from './lib/wind';
import {
  loadRainGrids,
  loadWindHistory,
  windAt,
  type DecodedRainGrid,
} from './rain-inputs.store';
import {
  RainfallEngineClient,
  type NowcastMethod,
  type RainNowcastResponse,
} from './rainfall-engine.client';
import {
  buildNowcastRequest,
  maxSteeringWindAgeMs,
  NOWCAST_HORIZONS_HOURS,
} from './rainfall-nowcast.service';
import { getDistrictPoints } from './weather-samples.store';

const HOUR_MS = 60 * 60 * 1000;
export const MAX_BACKTEST_HOURS = 72;
const METHODS: NowcastMethod[] = [
  'persistence',
  'motion_advection',
  'steering_wind_advection',
];
const DIRECTION_PREDICTORS = [
  'tracked_motion_persistence',
  'wind_10m',
  'wind_850hPa',
  'wind_700hPa',
] as const;

export const BACKTEST_CAVEATS = [
  'Truth is the same GSMaP_Gauge_NOW product the forecasts start from — a satellite estimate, not rain gauges; its own last half hour is extrapolated with cloud motion vectors, which can flatter motion_advection.',
  'Only the hours currently stored are used (GSMaP_NOW keeps 24 h); results from one day are anecdotal, not a skill estimate.',
  'Observed rain at a district = the ~11 km cell containing its reference point.',
  'Realized motion = the motion tracked from t to t+1 h (same block matching), only where it was trackable with r ≥ 0.5.',
  'GSMaP_NOW carries some regions over unchanged hour to hour (light rain, mostly 90-110°E); motion is not tracked there (movement status unchanged_field), but persistence is still scored there and is flattered by it.',
];

export interface BacktestResult {
  status: 'completed' | 'insufficient_data';
  startedAt: string;
  completedAt: string;
  window: { from: string; to: string } | null;
  framesAvailable: number;
  startTimesEvaluated: number;
  thresholdMmPerHour: number | null;
  modelVersions: Record<string, string> | null;
  /** Motion status over all evaluated district-hours (how much was trackable). */
  movementStatusCounts: Record<string, number>;
  methods: Array<{
    method: NowcastMethod;
    horizonHours: number;
    score: ReturnType<ProbabilisticScore['summary']>;
  }>;
  direction: Array<{
    predictor: (typeof DIRECTION_PREDICTORS)[number];
    score: ReturnType<DirectionScore['summary']>;
  }>;
  caveats: string[];
  warnings: string[];
}

/**
 * Historical backtest of the Stage-1 nowcast methods over the stored GSMaP
 * fields (Milestone 2 evaluation; docs/RAINFALL_INTELLIGENCE.md). For each
 * start hour t with a field at t−1 h: run the engine exactly as live, then
 * score every method × horizon against the field observed at t+h. Also
 * validates "wind direction = rain direction" empirically: each candidate
 * direction at t is scored against the motion that was actually tracked
 * from t to t+1 h.
 *
 * Runs in the background (a 24 h window is ~20 engine calls); the last
 * result is kept in memory.
 */
@Injectable()
export class RainfallBacktestService {
  private readonly logger = new Logger(RainfallBacktestService.name);
  private running = false;
  private last: BacktestResult | null = null;

  constructor(
    private readonly engine: RainfallEngineClient,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(RainfallGrid)
    private readonly gridRepository: Repository<RainfallGrid>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  getLast(): BacktestResult | null {
    return this.last;
  }

  startInBackground(hours: number): boolean {
    if (this.running) return false;
    this.backtest(hours).catch((error: Error) =>
      this.logger.error(`Rain nowcast backtest failed: ${error.message}`),
    );
    return true;
  }

  async backtest(
    hours: number,
    now: Date = new Date(),
  ): Promise<BacktestResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      this.last = await this.evaluate(
        Math.min(Math.max(hours, 2), MAX_BACKTEST_HOURS),
        now,
      );
      return this.last;
    } finally {
      this.running = false;
    }
  }

  private async evaluate(hours: number, now: Date): Promise<BacktestResult> {
    const startedAt = new Date();
    const from = new Date(now.getTime() - hours * HOUR_MS);
    const grids = await loadRainGrids(
      this.gridRepository,
      GRID_PRODUCT,
      from,
      now,
    );
    const result: BacktestResult = {
      status: 'insufficient_data',
      startedAt: startedAt.toISOString(),
      completedAt: startedAt.toISOString(),
      window: grids.length
        ? {
            from: grids[0].validTime.toISOString(),
            to: grids[grids.length - 1].validTime.toISOString(),
          }
        : null,
      framesAvailable: grids.length,
      startTimesEvaluated: 0,
      thresholdMmPerHour: null,
      modelVersions: null,
      movementStatusCounts: {},
      methods: [],
      direction: [],
      caveats: BACKTEST_CAVEATS,
      warnings: [],
    };
    const byTime = new Map(grids.map((g) => [g.validTime.getTime(), g]));
    const starts = grids.filter(
      (g) =>
        byTime.has(g.validTime.getTime() - HOUR_MS) &&
        byTime.has(g.validTime.getTime() + HOUR_MS),
    );
    if (starts.length === 0) {
      result.warnings.push(
        'Need at least three consecutive hourly rain fields (t−1, t, t+1).',
      );
      result.completedAt = new Date().toISOString();
      return result;
    }

    const districts = await getDistrictPoints(this.districtRepository);
    const districtById = new Map(districts.map((d) => [d.id, d]));
    const maxWindAgeMs = maxSteeringWindAgeMs(this.config);
    const winds = await loadWindHistory(
      this.sampleRepository,
      new Date(from.getTime() - maxWindAgeMs),
      now,
    );
    const scores = new Map<string, ProbabilisticScore>();
    const direction = new Map(
      DIRECTION_PREDICTORS.map((p) => [p, new DirectionScore()]),
    );
    const responses = new Map<number, RainNowcastResponse>();
    const runEngine = async (current: DecodedRainGrid) => {
      const key = current.validTime.getTime();
      const cached = responses.get(key);
      if (cached) return cached;
      const response = await this.engine.predictRainNowcast(
        buildNowcastRequest({
          issuedAt: current.validTime,
          current,
          previous: byTime.get(key - HOUR_MS) ?? null,
          districts,
          winds,
          maxWindAgeMs,
        }),
      );
      responses.set(key, response);
      return response;
    };

    for (const current of starts) {
      const t = current.validTime.getTime();
      const response = await runEngine(current);
      result.thresholdMmPerHour = response.thresholdMmPerHour;
      result.modelVersions = response.modelVersions;
      result.startTimesEvaluated += 1;

      for (const point of response.points) {
        result.movementStatusCounts[point.movement.status] =
          (result.movementStatusCounts[point.movement.status] ?? 0) + 1;
        const district = districtById.get(point.id);
        if (!district) continue;
        for (const forecast of point.forecasts) {
          if (forecast.status !== 'ok' || forecast.probability === null) {
            continue;
          }
          const observedGrid = byTime.get(t + forecast.horizonHours * HOUR_MS);
          const observed = observedGrid
            ? this.observedAt(
                observedGrid,
                district.latitude,
                district.longitude,
              )
            : null;
          if (observed === null) continue;
          const key = `${forecast.method}|${forecast.horizonHours}`;
          const score = scores.get(key) ?? new ProbabilisticScore();
          score.add(
            forecast.probability,
            observed >= response.thresholdMmPerHour,
          );
          scores.set(key, score);
        }
      }

      // Direction: candidates at t vs motion realized from t to t+1.
      const next = byTime.get(t + HOUR_MS);
      if (!next) continue;
      const realized = await runEngine(next);
      for (const point of response.points) {
        const truth = realized.points.find((p) => p.id === point.id)?.movement;
        if (
          !truth ||
          truth.status !== 'ok' ||
          truth.confidence !== 'low' ||
          truth.towardDeg === null
        ) {
          continue;
        }
        if (
          point.movement.status === 'ok' &&
          point.movement.towardDeg !== null
        ) {
          direction
            .get('tracked_motion_persistence')!
            .add(point.movement.towardDeg, truth.towardDeg);
        }
        const hour = windAt(
          winds.get(point.id),
          current.validTime,
          maxWindAgeMs,
        );
        for (const [predictor, level] of [
          ['wind_10m', '10m'],
          ['wind_850hPa', '850hPa'],
          ['wind_700hPa', '700hPa'],
        ] as const) {
          const wind = hour?.[level];
          if (wind && wind.speedKmh > 0) {
            direction
              .get(predictor)!
              .add(towardDeg(wind.fromDeg), truth.towardDeg);
          }
        }
      }
    }

    result.status = 'completed';
    result.methods = METHODS.flatMap((method) =>
      NOWCAST_HORIZONS_HOURS.map((horizonHours) => ({
        method,
        horizonHours,
        score: (
          scores.get(`${method}|${horizonHours}`) ?? new ProbabilisticScore()
        ).summary(),
      })),
    );
    result.direction = DIRECTION_PREDICTORS.map((predictor) => ({
      predictor,
      score: direction.get(predictor)!.summary(),
    }));
    result.completedAt = new Date().toISOString();
    this.logger.log(
      `Rain nowcast backtest: ${result.startTimesEvaluated} start hour(s) over ${result.framesAvailable} frame(s)`,
    );
    return result;
  }

  private observedAt(
    grid: DecodedRainGrid,
    latitude: number,
    longitude: number,
  ): number | null {
    const cell = domainCell(grid.domain, latitude, longitude);
    if (!cell) return null;
    const value = grid.values[cell.line * grid.domain.nx + cell.column];
    return Number.isFinite(value) ? value : null;
  }
}
