import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { FloodPointIn } from './lib/flood-inputs';
import type { GridDomain } from './lib/gsmap';

// CPU-bound block matching over up to ~514 points; same budget as the
// karhutla engines.
const ENGINE_TIMEOUT_MS = 60_000;
// Fitting 4 regularisation strengths × 3 horizons on up to a few hundred
// thousand merged rows.
const TRAINING_TIMEOUT_MS = 300_000;

export type NowcastMethod =
  | 'persistence'
  | 'motion_advection'
  | 'steering_wind_advection'
  | 'spatial_logistic';

/** Mirrors apps/ai-engine app/schemas/rainfall_spatial.py. */
export interface SpatialModelSpec {
  modelVersion: string;
  trainedAt: string;
  featureNames: string[];
  horizons: Record<string, { coefficients: number[]; intercept: number }>;
}

/** Mirrors apps/ai-engine app/schemas/rainfall.py (camelCase wire format). */
export interface RainNowcastRequest {
  issuedAt: string;
  grid: GridDomain;
  current: { validTime: string; dataB64: string };
  previous?: { validTime: string; dataB64: string };
  points: Array<{
    id: string;
    latitude: number;
    longitude: number;
    steeringWind?: {
      level: string;
      speedKmh: number;
      fromDeg: number;
      validTime: string;
    };
  }>;
  horizonsHours: number[];
  parameters?: Partial<{
    thresholdMmPerHour: number;
    halfWindowCells: number;
    maxShiftCells: number;
    baseRadiusKm: number;
    radiusGrowthKmPerHour: number;
  }>;
  spatialModel?: SpatialModelSpec;
}

export interface RainMovement {
  status:
    | 'ok'
    | 'no_rain_to_track'
    | 'unchanged_field'
    | 'insufficient_data'
    | 'no_previous_frame';
  towardDeg: number | null;
  speedKmh: number | null;
  eastKmh: number | null;
  northKmh: number | null;
  correlation: number | null;
  zeroShiftCorrelation: number | null;
  rainCellsTracked: number;
  unchangedFraction: number | null;
  confidence: 'low' | 'very_low';
}

export interface RainForecast {
  method: NowcastMethod;
  horizonHours: number;
  status: 'ok' | 'insufficient_data';
  probability: number | null;
  expectedMmPerHour: number | null;
  sourceLatitude: number | null;
  sourceLongitude: number | null;
  neighbourhoodRadiusKm: number | null;
  reason: string | null;
}

export interface RainNowcastPoint {
  id: string;
  currentMmPerHour: number | null;
  movement: RainMovement;
  /** Rain fraction within "50" / "100" km of the point at issue time. */
  neighbourhood: { rainFractionByRadiusKm: Record<string, number | null> };
  forecasts: RainForecast[];
  /** Stage-2 features per horizon ("1", "2", …); null where unusable. */
  spatialFeatures?: Record<string, number[] | null>;
}

export interface RainNowcastResponse {
  modelVersions: Record<string, string>;
  issuedAt: string;
  dataValidTime: string;
  thresholdMmPerHour: number;
  calibrated: boolean;
  gridMissingFraction: number;
  spatialFeatureNames: string[];
  spatialModelNote: string | null;
  points: RainNowcastPoint[];
}

export interface SpatialGateParameters {
  minHistoryDays: number;
  minTestPositives: number;
  minBssGain: number;
}

export interface RainSpatialTrainRequest {
  issuedAt: string;
  thresholdMmPerHour: number;
  featureNames: string[];
  horizonsHours: number[];
  history: {
    firstStart: string;
    lastStart: string;
    startHours: number;
    embargoedStartHours: number;
    splitBoundaries: [string, string];
  };
  /** [horizon, splitCode, label, weight, ...features] */
  rows: number[][];
  gate?: Partial<SpatialGateParameters>;
}

export interface SpatialProbScore {
  rows: number;
  positives: number;
  brier: number | null;
  brierSkillScore: number | null;
  averagePrecision: number | null;
  reliability: Array<{
    lower: number;
    upper: number;
    meanForecast: number;
    observedFrequency: number;
    weight: number;
  }>;
}

export interface SpatialHorizonModel {
  horizonHours: number;
  status: 'fitted' | 'insufficient_data';
  reason: string | null;
  regularizationC: number | null;
  coefficients: number[] | null;
  intercept: number | null;
  climatology: number | null;
  rowsBySplit: Record<string, number>;
  positivesBySplit: Record<string, number>;
  test: SpatialProbScore | null;
  comparisons: Array<{
    baseline: string;
    baselineScore: SpatialProbScore;
    modelScore: SpatialProbScore;
  }>;
  promoted: boolean;
  gateReasons: string[];
}

export interface RainSpatialTrainResponse {
  modelVersion: string;
  issuedAt: string;
  featureNames: string[];
  historyDays: number;
  gate: SpatialGateParameters;
  horizons: SpatialHorizonModel[];
}

export type FloodRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface FloodRiskParameters {
  hourlyLebatMm: number;
  hourlySangatLebatMm: number;
  dailyLebatMm: number;
  dailySangatLebatMm: number;
  dailyEkstremMm: number;
  susceptibilityBreaks: [number, number] | null;
  downgradeLowSusceptibility: boolean;
}

/** Mirrors apps/ai-engine app/schemas/rainfall_flood.py. */
export interface RainFloodRiskRequest {
  issuedAt: string;
  points: FloodPointIn[];
  parameters?: Partial<FloodRiskParameters>;
}

export interface FloodFactor {
  factor: string;
  value: number | null;
  unit: string;
  assessment: string | null;
  effect: 'raised' | 'lowered' | 'none' | 'not_scored' | 'not_available';
  /** Point-specific context; the general basis is in `factorBases`. */
  detail: string | null;
  source: string | null;
}

export interface FloodRiskPoint {
  id: string;
  status: 'ok' | 'insufficient_data';
  level: FloodRiskLevel | null;
  probability: null;
  rainTriggerLevel: FloodRiskLevel | null;
  hourlyCategory: string | null;
  dailyCategory: string | null;
  susceptibilityClass: 'low' | 'medium' | 'high' | 'unknown';
  gaugeFloor: FloodRiskLevel | null;
  confidence: 'low' | 'very_low';
  confidenceReasons: string[];
  timeToRiskHours: null;
  factors: FloodFactor[];
  reason: string | null;
}

export interface RainFloodRiskResponse {
  modelVersion: string;
  issuedAt: string;
  calibrated: boolean;
  parameters: FloodRiskParameters;
  /** factor → why it can (or cannot) change the level. */
  factorBases: Record<string, string>;
  missingInputs: string[];
  points: FloodRiskPoint[];
}

/** Mirrors apps/ai-engine app/schemas/rainfall_landslide.py. */
export interface LandslidePointIn {
  id: string;
  rainfall?: FloodPointIn['rainfall'];
  antecedent?: FloodPointIn['antecedent'];
  soilMoisture?: FloodPointIn['soilMoisture'];
  terrain?: { source: string; dem: string; slopeSamplesDeg: number[] };
}

export interface LandslideRiskParameters {
  lowerIdAlpha: number;
  lowerIdBeta: number;
  upperIdAlpha: number;
  upperIdBeta: number;
  triggerWindowsHours: number[];
  slopeGentleMaxPercent: number;
  slopeSteepMinPercent: number;
  slopeQuantile: number;
  minTerrainSamples: number;
  downgradeGentleTerrain: boolean;
}

export interface RainLandslideRiskRequest {
  issuedAt: string;
  points: LandslidePointIn[];
  parameters?: Partial<LandslideRiskParameters>;
}

export interface LandslideRiskPoint {
  id: string;
  status: 'ok' | 'insufficient_data';
  level: FloodRiskLevel | null;
  probability: null;
  rainTriggerLevel: FloodRiskLevel | null;
  triggerClass: 'below_lower' | 'above_lower' | 'above_upper' | null;
  criticalWindowHours: number | null;
  terrainClass: 'low' | 'medium' | 'high' | 'unknown';
  slopePercentAtQuantile: number | null;
  confidence: 'low' | 'very_low';
  confidenceReasons: string[];
  timeToRiskHours: null;
  factors: FloodFactor[];
  reason: string | null;
}

export interface RainLandslideRiskResponse {
  modelVersion: string;
  issuedAt: string;
  calibrated: boolean;
  parameters: LandslideRiskParameters;
  factorBases: Record<string, string>;
  missingInputs: string[];
  points: LandslideRiskPoint[];
}

/** Same internal-REST + `X-Internal-Token` pattern as KarhutlaEngineClient. */
// --- Milestone 7: hazard backtest (ai-engine app/schemas/rainfall_backtest.py)

export interface RainHazardReplayRequest {
  seriesStart: string;
  hours: number;
  /** float32 LE [points x hours], NaN = missing, base64. */
  dataB64: string;
  firstDay: string;
  days: number;
  points: Array<{
    id: string;
    utcOffsetHours: number;
    floodHazardIndex?: number | null;
    slopeSamplesDeg?: number[] | null;
  }>;
  floodParameters?: { susceptibilityBreaks?: [number, number] | null };
  minHoursIssuedPerDay?: number;
}

export interface RainHazardReplayResponse {
  modelVersions: Record<string, string>;
  firstDay: string;
  days: number;
  points: Array<{
    id: string;
    floodLevel: number[];
    floodTrigger: number[];
    landslideLevel: number[];
    landslideTrigger: number[];
  }>;
}

export interface RainHazardBacktestRequest {
  issuedAt: string;
  firstDay: string;
  points: number;
  days: number;
  testStartDay: number;
  embargoDays?: number;
  toleranceDays?: number;
  minCellsForRate?: number;
  hazards: Array<{
    hazard: 'flood' | 'landslide';
    /** int8 [points x days], base64. */
    levelsB64: string;
    triggersB64: string;
    eventsB64: string;
  }>;
}

export interface BacktestContingency {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctNegatives: number;
  pod: number | null;
  far: number | null;
  csi: number | null;
  frequencyBias: number | null;
  lift: number | null;
  podTolerant: number | null;
  farTolerant: number | null;
}

export interface HazardBacktestResult {
  hazard: 'flood' | 'landslide';
  splits: Array<{
    split: 'calibration' | 'test';
    firstDay: string;
    lastDay: string;
    evaluableCells: number;
    events: number;
    baseRate: number | null;
    thresholds: Array<{
      threshold: string;
      rule: BacktestContingency;
      rainOnly: BacktestContingency;
    }>;
    persistence: BacktestContingency;
    ratesByLevel: Array<{
      level: string;
      cells: number;
      events: number;
      rate: number | null;
      ci95: [number, number] | null;
    }>;
  }>;
  probabilisticTest: Record<string, number | string[] | null>;
  notes: string[];
}

export interface RainHazardBacktestResponse {
  modelVersion: string;
  issuedAt: string;
  firstDay: string;
  days: number;
  toleranceDays: number;
  hazards: HazardBacktestResult[];
}

@Injectable()
export class RainfallEngineClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  predictRainNowcast(
    payload: RainNowcastRequest,
  ): Promise<RainNowcastResponse> {
    return this.post<RainNowcastResponse>('/predict-rain-nowcast', payload);
  }

  predictRainFloodRisk(
    payload: RainFloodRiskRequest,
  ): Promise<RainFloodRiskResponse> {
    return this.post<RainFloodRiskResponse>(
      '/predict-rain-flood-risk',
      payload,
    );
  }

  predictRainLandslideRisk(
    payload: RainLandslideRiskRequest,
  ): Promise<RainLandslideRiskResponse> {
    return this.post<RainLandslideRiskResponse>(
      '/predict-rain-landslide-risk',
      payload,
    );
  }

  trainRainNowcastSpatial(
    payload: RainSpatialTrainRequest,
  ): Promise<RainSpatialTrainResponse> {
    return this.post<RainSpatialTrainResponse>(
      '/train-rain-nowcast-spatial',
      payload,
      TRAINING_TIMEOUT_MS,
    );
  }

  replayRainHazardRules(
    payload: RainHazardReplayRequest,
  ): Promise<RainHazardReplayResponse> {
    return this.post<RainHazardReplayResponse>(
      '/replay-rain-hazard-rules',
      payload,
      TRAINING_TIMEOUT_MS,
    );
  }

  evaluateRainHazardBacktest(
    payload: RainHazardBacktestRequest,
  ): Promise<RainHazardBacktestResponse> {
    return this.post<RainHazardBacktestResponse>(
      '/evaluate-rain-hazard-backtest',
      payload,
      TRAINING_TIMEOUT_MS,
    );
  }

  private post<T>(
    path: string,
    payload: unknown,
    timeout = ENGINE_TIMEOUT_MS,
  ): Promise<T> {
    return firstValueFrom(
      this.http.post<T>(
        `${this.config.get<string>('AI_ENGINE_URL')}${path}`,
        payload,
        {
          headers: {
            'X-Internal-Token': this.config.get<string>(
              'INTERNAL_SERVICE_TOKEN',
            ),
          },
          timeout,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      ),
    ).then((response) => response.data);
  }
}
