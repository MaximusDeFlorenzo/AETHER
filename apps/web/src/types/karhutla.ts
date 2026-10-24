// Mirrors apps/api karhutla-prediction/lib/views.ts. Kept apart from
// types/domain.ts: everything here is experimental model output.

export type GeoPolygon =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export type KarhutlaRunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type KarhutlaForecastStatus = 'ok' | 'partial' | 'insufficient_data' | 'failed';
export type SmokeLevel = 'core' | 'likely' | 'possible';
export type QualitativeConfidence = 'low' | 'very_low';

export interface SpreadHorizon {
  horizonHours: number;
  validAt: string;
  status: 'ok' | 'insufficient_data';
  hoursSinceObservation: number;
  envelope: GeoPolygon | null;
  areaKm2: number | null;
  headBearingDeg: number | null;
  maxHeadDistanceKm: number | null;
  meanWindSpeedKmh: number | null;
  meanWindFromDeg: number | null;
  meanHeadRosKmh: number | null;
  factors: {
    estimatedFineFuelMoisturePct: number | null;
    moistureFactor: number;
    slopeDeg: number | null;
    slopeFactor: number;
    lengthToBreadth: number;
  } | null;
  notes: string[];
}

export interface SmokeHorizon {
  horizonHours: number;
  validAt: string;
  status: 'ok' | 'insufficient_data';
  particlesAirborne: number;
  footprint: Array<{ level: SmokeLevel; particleShare: number; geometry: GeoPolygon | null; areaKm2: number }>;
  cellSizeKm: number | null;
  transportBearingDeg: number | null;
  p90DistanceKm: number | null;
  shareAboveBoundaryLayer: number | null;
  shareOutsideWindDomain: number | null;
  notes: string[];
}

interface EngineOutput<H> {
  modelVersion: string;
  method: string;
  horizons: H[];
  confidence: QualitativeConfidence;
  warnings: string[];
  limitations: string[];
  assumptions: Record<string, number | string>;
}

export type SpreadOutput = EngineOutput<SpreadHorizon> & {
  latestObservationAt: string;
  observedFootprintAreaKm2: number;
};
export type SmokeOutput = EngineOutput<SmokeHorizon> & { qualitative: true };

export interface ExposedPlace {
  id: string;
  name: string;
  kind: 'district_reference_point' | 'settlement';
  placeType: string | null;
  provinceName: string | null;
  latitude: number;
  longitude: number;
  source: 'aether_districts' | 'openstreetmap';
  distanceFromFireKm: number;
}

export interface HorizonExposure {
  horizonHours: number;
  spread: ExposedPlace[];
  smoke: Record<SmokeLevel, ExposedPlace[]>;
}

export interface KarhutlaRecommendation {
  code: string;
  audience: 'responders' | 'public';
  priority: 'info' | 'advisory' | 'priority';
  text: string;
  basis: string;
}

export interface KarhutlaDataQuality {
  hotspotAgeHours: number;
  hotspotFreshness: 'fresh' | 'aging' | 'stale';
  weatherAgeMinutes: number | null;
  weatherCoverage: { firstHour: string | null; lastHour: string | null; coversObservationToMaxHorizon: boolean };
  atmosphereGridCoverage: number;
  terrainAvailable: boolean;
  issues: string[];
}

export interface SurfaceWeatherHour {
  time: string;
  windSpeedKmh: number;
  windFromDeg: number;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  precipitationMm: number | null;
  boundaryLayerHeightM: number | null;
}

export interface KarhutlaForecast {
  id: string;
  rank: number;
  status: KarhutlaForecastStatus;
  confidence: QualitativeConfidence | null;
  location: {
    latitude: number;
    longitude: number;
    label: string | null;
    nearestDistrict: { id: string; name: string } | null;
  };
  observed: {
    kind: 'observation';
    source: string;
    hotspotCount: number;
    totalFrpMw: number | null;
    maxConfidence: number | null;
    firstObservedAt: string;
    latestObservedAt: string;
    sensors: string[];
    hotspots: Array<{
      id: string;
      latitude: number;
      longitude: number;
      observedAt: string;
      frpMw: number | null;
      confidence: number | null;
    }>;
    pixelFootprint: GeoPolygon | null;
  };
  predicted: { kind: 'model_output'; spread: SpreadOutput | null; smoke: SmokeOutput | null };
  weather: {
    provenance: { provider: string; kind: string; model: string; attribution: string };
    retrievedAt: string;
    surfaceHours: SurfaceWeatherHour[];
    terrain: { source: string; centerElevationM: number } | null;
  } | null;
  dataQuality: KarhutlaDataQuality;
  exposure: HorizonExposure[];
  recommendations: KarhutlaRecommendation[];
  error: string | null;
}

export interface KarhutlaRun {
  id: string;
  status: KarhutlaRunStatus;
  trigger: 'scheduled' | 'manual';
  issuedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  horizonsHours: number[];
  maxClusters: number;
  hotspotWindowHours: number;
  modelVersions: { spread: string | null; smoke: string | null };
  inputSummary: {
    hotspotsInWindow: number;
    hotspotsUsed: number;
    excludedLowConfidence: number;
    excludedFutureTimestamps: number;
    excludedInvalid: number;
    duplicatesRemoved: number;
    clustersFound: number;
    clustersForecast: number;
    sources: Array<{
      id: string;
      name: string;
      kind: string;
      attribution?: string;
      latestObservationAt?: string | null;
      enabled?: boolean;
    }>;
  } | null;
  warnings: string[];
  error: string | null;
  disclaimer: string;
  forecasts?: KarhutlaForecast[];
}

export interface KarhutlaLatest {
  run: KarhutlaRun | null;
  activeRun: KarhutlaRun | null;
}

export interface KarhutlaVerification {
  runId: string;
  issuedAt: string | null;
  method?: string;
  clusters: Array<{
    forecastId: string;
    rank: number;
    horizons: Array<{
      horizonHours: number;
      validAt: string;
      evaluable: boolean;
      reason: string | null;
      newHotspots: number;
      insideEnvelope: number;
      insidePersistenceBaseline: number;
      envelopeAreaKm2: number | null;
      baselineAreaKm2: number | null;
    }>;
  }>;
}
