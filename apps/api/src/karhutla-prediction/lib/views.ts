import type {
  KarhutlaClusterForecast,
  KarhutlaPredictionRun,
} from '../../database/entities';

/**
 * API response shapes. A forecast is always split into `observed` (what
 * satellites detected) and `predicted` (what the engines produced), so no
 * client can mistake a model polygon for an observation.
 */

export const KARHUTLA_DISCLAIMER =
  'Experimental decision-support output. Spread envelopes are upper-bound scenarios and smoke ' +
  'footprints are qualitative particle-transport estimates; neither is calibrated, validated, or a ' +
  'probability. Satellite hotspots are thermal anomalies, not confirmed fires. Verify on the ground ' +
  'and follow BPBD, BMKG and KLHK guidance; AETHER does not replace official authorities.';

/** Compact observed hotspot for map display: [lon, lat] + metadata. */
export interface HotspotPoint {
  id: string;
  latitude: number;
  longitude: number;
  observedAt: Date;
  frpMw: number | null;
  confidence: number | null;
}

export const HOTSPOT_SOURCE_LABEL =
  'NASA FIRMS — MODIS (Terra/Aqua) + VIIRS (S-NPP/NOAA-20/NOAA-21) Near Real-Time (thermal anomalies)';

export function toForecastView(
  forecast: KarhutlaClusterForecast,
  hotspots: Map<string, HotspotPoint> = new Map(),
) {
  return {
    id: forecast.id,
    rank: forecast.rank,
    status: forecast.status,
    confidence: forecast.confidence,
    location: {
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      label: forecast.locationLabel,
      nearestDistrict: forecast.nearestDistrict
        ? {
            id: forecast.nearestDistrict.id,
            name: forecast.nearestDistrict.name,
          }
        : null,
    },
    observed: {
      kind: 'observation' as const,
      source: HOTSPOT_SOURCE_LABEL,
      hotspotCount: forecast.hotspotCount,
      totalFrpMw: forecast.totalFrpMw,
      maxConfidence: forecast.maxConfidence,
      firstObservedAt: forecast.firstObservedAt,
      latestObservedAt: forecast.latestObservedAt,
      sensors: forecast.sensors,
      hotspotEventIds: forecast.hotspotEventIds,
      hotspots: forecast.hotspotEventIds
        .map((id) => hotspots.get(id))
        .filter((h): h is HotspotPoint => Boolean(h)),
      pixelFootprint: forecast.observedFootprint,
    },
    predicted: {
      kind: 'model_output' as const,
      spread: forecast.spread,
      smoke: forecast.smoke,
    },
    weather: forecast.weather,
    dataQuality: forecast.dataQuality,
    exposure: forecast.exposure,
    recommendations: forecast.recommendations,
    error: forecast.error,
  };
}

export function toRunView(
  run: KarhutlaPredictionRun,
  includeForecasts: boolean,
  hotspots: Map<string, HotspotPoint> = new Map(),
) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    issuedAt: run.issuedAt,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    horizonsHours: run.horizonsHours,
    maxClusters: run.maxClusters,
    hotspotWindowHours: run.hotspotWindowHours,
    modelVersions: {
      spread: run.spreadModelVersion,
      smoke: run.smokeModelVersion,
    },
    inputSummary: run.inputSummary,
    warnings: run.warnings,
    error: run.error,
    disclaimer: KARHUTLA_DISCLAIMER,
    ...(includeForecasts
      ? {
          forecasts: [...(run.forecasts ?? [])]
            .sort((a, b) => a.rank - b.rank)
            .map((forecast) => toForecastView(forecast, hotspots)),
        }
      : {}),
  };
}
