import type {
  EarthquakeDetails,
  FloodDetails,
  HazardEvent,
  LandslideDetails,
  WildfireDetails,
} from '@/types/domain';

// Thresholds mirrored from apps/ai-engine (flood.py/wildfire.py's
// MAX_RELEVANT_*, explainability.py's HIGH_WATER_LEVEL_M/HIGH_FRP_CONFIDENCE)
// so "high severity" cues (map marker pulse, alert sound) match what the
// risk engine itself treats as significant. Shared by the map (visual pulse)
// and use-realtime-sync (alert sound) so the two never drift apart.
const HIGH_MAGNITUDE = 6;
const HIGH_SOIL_SATURATION_PCT = 80;
const HIGH_WATER_LEVEL_M = 3.0;
const HIGH_FRP_CONFIDENCE = 0.75;

export function isHighSeverityHazardEvent(event: HazardEvent): boolean {
  if (event.hazardType === 'earthquake') {
    return ((event.details as EarthquakeDetails).magnitude ?? 0) >= HIGH_MAGNITUDE;
  }
  if (event.hazardType === 'landslide') {
    return ((event.details as LandslideDetails).soilSaturationPct ?? 0) >= HIGH_SOIL_SATURATION_PCT;
  }
  if (event.hazardType === 'flood') {
    return ((event.details as FloodDetails).waterLevelM ?? 0) >= HIGH_WATER_LEVEL_M;
  }
  if (event.hazardType === 'wildfire') {
    return ((event.details as WildfireDetails).frpConfidence ?? 0) >= HIGH_FRP_CONFIDENCE;
  }
  return false;
}
