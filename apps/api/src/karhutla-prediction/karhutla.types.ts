import type { PolygonalGeometry } from './lib/geo';

// Wire types for apps/ai-engine's /predict-fire-spread and
// /predict-smoke-transport (app/schemas/karhutla.py). camelCase on the wire.

export type EngineConfidence = 'low' | 'very_low';
export type HorizonStatus = 'ok' | 'insufficient_data';

export interface FireSpreadRequest {
  issuedAt: string;
  horizonsHours: number[];
  hotspots: Array<{
    latitude: number;
    longitude: number;
    observedAt: string;
    scanKm: number | null;
    trackKm: number | null;
    frpMw: number | null;
    confidence: number | null;
  }>;
  weather: Array<{
    time: string;
    windSpeedKmh: number;
    windFromDeg: number;
    temperatureC: number | null;
    relativeHumidityPct: number | null;
    precipitationMm: number | null;
  }>;
  terrain: {
    centerElevationM: number;
    ringRadiusKm: number;
    ring: Array<{ bearingDeg: number; elevationM: number }>;
  } | null;
}

export interface SpreadHorizonResult {
  horizonHours: number;
  validAt: string;
  status: HorizonStatus;
  hoursSinceObservation: number;
  envelope: PolygonalGeometry | null;
  areaKm2: number | null;
  headBearingDeg: number | null;
  maxHeadDistanceKm: number | null;
  meanWindSpeedKmh: number | null;
  meanWindFromDeg: number | null;
  meanHeadRosKmh: number | null;
  factors: Record<string, number | null> | null;
  notes: string[];
}

export interface FireSpreadResponse {
  modelVersion: string;
  method: string;
  latestObservationAt: string;
  observedFootprint: PolygonalGeometry;
  observedFootprintAreaKm2: number;
  horizons: SpreadHorizonResult[];
  confidence: EngineConfidence;
  warnings: string[];
  limitations: string[];
  assumptions: Record<string, number | string>;
}

export interface SmokeTransportRequest {
  issuedAt: string;
  horizonsHours: number[];
  source: {
    latitude: number;
    longitude: number;
    latestObservationAt: string;
    hotspotCount: number;
    totalFrpMw: number | null;
    sourceRadiusKm: number;
  };
  atmosphere: Array<{
    latitude: number;
    longitude: number;
    hours: Array<{
      time: string;
      boundaryLayerHeightM: number | null;
      precipitationMm: number | null;
      levels: Array<{
        heightAglM: number;
        windSpeedKmh: number;
        windFromDeg: number;
      }>;
    }>;
  }>;
  particles: number;
  seed: number;
}

export interface SmokeHorizonResult {
  horizonHours: number;
  validAt: string;
  status: HorizonStatus;
  particlesAirborne: number;
  footprint: Array<{
    level: 'core' | 'likely' | 'possible';
    particleShare: number;
    geometry: PolygonalGeometry | null;
    areaKm2: number;
  }>;
  cellSizeKm: number | null;
  centroid: { type: 'Point'; coordinates: [number, number] } | null;
  transportBearingDeg: number | null;
  p90DistanceKm: number | null;
  shareAboveBoundaryLayer: number | null;
  shareOutsideWindDomain: number | null;
  notes: string[];
}

export interface SmokeTransportResponse {
  modelVersion: string;
  method: string;
  qualitative: true;
  horizons: SmokeHorizonResult[];
  confidence: EngineConfidence;
  warnings: string[];
  limitations: string[];
  assumptions: Record<string, number | string>;
}
