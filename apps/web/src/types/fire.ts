// Public fire map API (apps/api src/public-fire): FIRMS hotspot clusters
// and the latest karhutla smoke forecast, for the anonymous citizen portal.

export type ConfidenceClass = 'low' | 'nominal' | 'high';

export interface HotspotCluster {
  /** Also a real hazard_event id (the cluster's first detection). */
  id: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  detections: number;
  totalFrpMw: number | null;
  /** Summed FRP of the strongest single satellite overpass. */
  peakOverpassFrpMw: number | null;
  /** CO2 emission rate at that overpass (FRP × 0.368 kg/MJ × 1.62 kg/kg). */
  co2TonnesPerHour: number | null;
  confidenceClass: ConfidenceClass | null;
  /** e.g. "MODIS Aqua", "VIIRS NOAA-20". */
  sensors: string[];
  firstObservedAt: string;
  latestObservedAt: string;
  country: { iso: string; name: string } | null;
  insideIndonesia: boolean;
  nearestDistrict: { id: string; name: string; provinceName: string | null; distanceKm: number } | null;
}

export interface HotspotMap {
  generatedAt: string;
  window: { from: string; to: string; hours: number };
  attribution: string;
  sensors: Array<{ label: string; detections: number; latestObservedAt: string }>;
  totals: { detections: number; lowConfidenceExcluded: number; clusters: number; clustersInIndonesia: number };
  /** Strongest first, plus every cluster near the citizen. */
  clusters: HotspotCluster[];
  truncated: boolean;
}

export interface HotspotPoint {
  id: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  sensor: string;
  confidenceClass: ConfidenceClass | null;
  frpMw: number | null;
}

export type SmokeLevel = 'core' | 'likely' | 'possible';

export type PolygonalGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface ModelSmokeForecast {
  id: string;
  rank: number;
  clusterId: string | null;
  latitude: number;
  longitude: number;
  nearestDistrictName: string | null;
  confidence: string | null;
  latestObservedAt: string;
  hotspotFreshness: string | null;
  /** The run horizon valid closest to the requested time, if within 3 h. */
  horizon: {
    horizonHours: number;
    validAt: string;
    transportBearingDeg: number | null;
    p90DistanceKm: number | null;
    footprint: Array<{ level: SmokeLevel; geometry: PolygonalGeometry; areaKm2: number }>;
  } | null;
  /** Earliest current-or-future horizon covering the citizen. */
  reach: { horizonHours: number; validAt: string; hoursFromNow: number; level: SmokeLevel } | null;
}

export interface ModelSmoke {
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
  forecasts: ModelSmokeForecast[];
}
