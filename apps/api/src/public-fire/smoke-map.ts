import { haversineKm, pointInGeometry } from '../karhutla-prediction/lib/geo';
import type { PolygonalGeometry } from '../karhutla-prediction/lib/geo';
import type { SmokeHorizonResult } from '../karhutla-prediction/karhutla.types';
import type { MapCluster } from './hotspot-map';

/**
 * The citizen portal's slice of the latest karhutla run: per forecast
 * cluster, ONE smoke horizon (the one valid closest to "now + N hours") and
 * — given the citizen's location — the earliest horizon whose footprint
 * covers them. Geometry for every horizon would be ~65 KB per cluster;
 * operators get the full run from the authenticated karhutla API.
 */

export type SmokeLevel = 'core' | 'likely' | 'possible';

export interface PublicSmokeHorizon {
  horizonHours: number;
  validAt: string;
  transportBearingDeg: number | null;
  p90DistanceKm: number | null;
  footprint: Array<{
    level: SmokeLevel;
    geometry: PolygonalGeometry;
    areaKm2: number;
  }>;
}

export interface PublicSmokeForecast {
  id: string;
  rank: number;
  /** Matching cluster in GET /public/hotspots, when one is found. */
  clusterId: string | null;
  latitude: number;
  longitude: number;
  nearestDistrictName: string | null;
  confidence: string | null;
  latestObservedAt: string;
  hotspotFreshness: string | null;
  horizon: PublicSmokeHorizon | null;
  /** Earliest current-or-future horizon whose footprint covers the citizen
   * (lat/lng given). `hoursFromNow` is 0 for smoke already overhead. */
  reach: {
    horizonHours: number;
    validAt: string;
    hoursFromNow: number;
    level: SmokeLevel;
  } | null;
}

export interface ForecastInput {
  id: string;
  rank: number;
  latitude: number;
  longitude: number;
  nearestDistrictName: string | null;
  confidence: string | null;
  latestObservedAt: Date;
  hotspotEventIds: string[];
  dataQuality: Record<string, unknown>;
  smoke: { horizons?: SmokeHorizonResult[] } | null;
}

// A forecast with no shared hotspot ids is matched to the nearest map
// cluster only this close (both are centroids of overlapping detections).
const CLUSTER_MATCH_KM = 10;
// A horizon valid further than this from the requested display time isn't
// shown (the portal draws its simple plume instead) — e.g. "12 jam" on a run
// whose last horizon is 6 h.
const MAX_HORIZON_GAP_MS = 3 * 3_600_000;
// Horizons valid more than this before now are history, not a forecast.
const PAST_HORIZON_GRACE_MS = 3_600_000;
const LEVEL_ORDER: SmokeLevel[] = ['core', 'likely', 'possible'];

function usableHorizons(forecast: ForecastInput): SmokeHorizonResult[] {
  return (forecast.smoke?.horizons ?? []).filter(
    (h) => h.status === 'ok' && h.footprint.some((f) => f.geometry),
  );
}

/** The ok horizon valid closest to `target` (within 3 h); ties go to the
 * earlier one. */
export function pickHorizon(
  horizons: SmokeHorizonResult[],
  target: Date,
): SmokeHorizonResult | null {
  let best: { horizon: SmokeHorizonResult; gap: number } | null = null;
  for (const horizon of horizons) {
    const gap = Math.abs(
      new Date(horizon.validAt).getTime() - target.getTime(),
    );
    if (gap <= MAX_HORIZON_GAP_MS && (!best || gap < best.gap)) {
      best = { horizon, gap };
    }
  }
  return best?.horizon ?? null;
}

/** Shared hotspot ids first (largest overlap), then nearest centroid. */
export function matchCluster(
  forecast: ForecastInput,
  clusters: Pick<
    MapCluster,
    'id' | 'latitude' | 'longitude' | 'hotspotEventIds'
  >[],
): string | null {
  const ids = new Set(forecast.hotspotEventIds);
  let best: { id: string; overlap: number } | null = null;
  for (const cluster of clusters) {
    const overlap = cluster.hotspotEventIds.filter((id) => ids.has(id)).length;
    if (overlap > 0 && overlap > (best?.overlap ?? 0)) {
      best = { id: cluster.id, overlap };
    }
  }
  if (best) return best.id;

  let nearest: { id: string; km: number } | null = null;
  for (const cluster of clusters) {
    const km = haversineKm(
      forecast.latitude,
      forecast.longitude,
      cluster.latitude,
      cluster.longitude,
    );
    if (km <= CLUSTER_MATCH_KM && km < (nearest?.km ?? Infinity)) {
      nearest = { id: cluster.id, km };
    }
  }
  return nearest?.id ?? null;
}

export function smokeReach(
  horizons: SmokeHorizonResult[],
  latitude: number,
  longitude: number,
  now: Date,
): PublicSmokeForecast['reach'] {
  const ordered = horizons
    .filter(
      (h) =>
        new Date(h.validAt).getTime() >= now.getTime() - PAST_HORIZON_GRACE_MS,
    )
    .sort((a, b) => a.horizonHours - b.horizonHours);
  for (const horizon of ordered) {
    for (const level of LEVEL_ORDER) {
      const part = horizon.footprint.find((f) => f.level === level);
      if (
        part?.geometry &&
        pointInGeometry(latitude, longitude, part.geometry)
      ) {
        const ahead = new Date(horizon.validAt).getTime() - now.getTime();
        return {
          horizonHours: horizon.horizonHours,
          validAt: horizon.validAt,
          hoursFromNow: Math.max(0, Math.round(ahead / 3_600_000)),
          level,
        };
      }
    }
  }
  return null;
}

export function toPublicSmokeForecast(
  forecast: ForecastInput,
  clusters: Parameters<typeof matchCluster>[1],
  now: Date,
  target: Date,
  citizen?: { latitude: number; longitude: number },
): PublicSmokeForecast {
  const horizons = usableHorizons(forecast);
  const picked = pickHorizon(horizons, target);
  const freshness = forecast.dataQuality?.hotspotFreshness;
  return {
    id: forecast.id,
    rank: forecast.rank,
    clusterId: matchCluster(forecast, clusters),
    latitude: forecast.latitude,
    longitude: forecast.longitude,
    nearestDistrictName: forecast.nearestDistrictName,
    confidence: forecast.confidence,
    latestObservedAt: forecast.latestObservedAt.toISOString(),
    hotspotFreshness: typeof freshness === 'string' ? freshness : null,
    horizon: picked
      ? {
          horizonHours: picked.horizonHours,
          validAt: picked.validAt,
          transportBearingDeg: picked.transportBearingDeg,
          p90DistanceKm: picked.p90DistanceKm,
          footprint: picked.footprint.flatMap((f) =>
            f.geometry
              ? [{ level: f.level, geometry: f.geometry, areaKm2: f.areaKm2 }]
              : [],
          ),
        }
      : null,
    reach: citizen
      ? smokeReach(horizons, citizen.latitude, citizen.longitude, now)
      : null,
  };
}
