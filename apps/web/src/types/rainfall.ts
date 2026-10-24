// Mirrors apps/api/src/rainfall-intelligence/rainfall-outlook.service.ts
// (GET /rainfall/outlook, docs/RAINFALL_INTELLIGENCE.md §8).

export type RainfallSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type RainfallFreshness = 'fresh' | 'aging' | 'stale';

export interface RainfallRecommendation {
  code: string;
  audience: 'responders' | 'public';
  priority: 'info' | 'advisory' | 'priority';
  text: string;
  /** Same advice in Bahasa Indonesia. */
  textId: string;
  basis: string;
}

interface RiskSummary {
  status: 'ok' | 'insufficient_data';
  level: RainfallSeverity | null;
  confidence: 'low' | 'very_low';
  /** Omitted in the compact view. */
  confidenceReasons?: string[];
  raisedBy: string[];
}

export interface FloodOutlook extends RiskSummary {
  gauge: { name: string; label: string } | null;
}

export interface LandslideOutlook extends RiskSummary {
  terrainClass: 'low' | 'medium' | 'high' | 'unknown';
}

export interface RainOutlook {
  currentMmPerHour: number | null;
  nextHourProbability: number | null;
  method: string | null;
  calibrated: boolean;
  freshness: RainfallFreshness;
  dataValidTime: string | null;
  movement: {
    status: string;
    towardDeg: number | null;
    speedKmh: number | null;
    confidence: string | null;
  } | null;
}

export interface DistrictOutlook {
  districtId: string;
  districtName: string;
  provinceName: string | null;
  latitude: number;
  longitude: number;
  severity: RainfallSeverity | null;
  rain: RainOutlook | null;
  flood: FloodOutlook | null;
  landslide: LandslideOutlook | null;
  exposure: { population: number; densityPerKm2: number; year: number; source: string } | null;
  recommendationCodes: string[];
  /** Only in the full (non-compact) view. */
  recommendations?: RainfallRecommendation[];
}

export interface OutlookRunRef {
  runId: string;
  issuedAt: string;
  dataValidTime: string | null;
  modelVersions: unknown;
}

export interface RainfallOutlook {
  generatedAt: string;
  rulesVersion: string;
  sources: {
    nowcast: OutlookRunRef | null;
    flood: OutlookRunRef | null;
    landslide: OutlookRunRef | null;
    population: string;
  };
  missing: string[];
  affectedAreaNote: string;
  disclaimer: string;
  districts: DistrictOutlook[];
}
