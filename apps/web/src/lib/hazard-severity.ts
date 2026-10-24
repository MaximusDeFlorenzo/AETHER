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

// hazard_events has no active/resolved status (docs/DATABASE_SCHEMA.md §10 —
// it's an append-only event log), so "ongoing" is a recency heuristic:
// mirrors dashboard.service.ts's ACTIVE_WINDOW_HOURS so "still active" means
// the same thing everywhere in the app.
const ONGOING_WINDOW_HOURS = 24;

// Adapters that only have raw coordinates (NASA FIRMS hotspots, a weather
// station with no riverBasin set) can leave `locationLabel`/`region` null.
// Older events ingested before the ingestion-side fallback existed also
// still have null locationLabel/region in the DB. Rendering that null
// directly leaves list rows with a blank, unclickable link and detail pages
// with a blank title — fall back to formatted coordinates so every event
// always has a visible, clickable label.
export function formatHazardEventLocation(event: HazardEvent): string {
  return event.locationLabel ?? `${event.latitude.toFixed(3)}, ${event.longitude.toFixed(3)}`;
}

export function isHighSeverityHazardEvent(event: HazardEvent): boolean {
  if (event.hazardType === 'earthquake') {
    return ((event.details as EarthquakeDetails | null)?.magnitude ?? 0) >= HIGH_MAGNITUDE;
  }
  if (event.hazardType === 'landslide') {
    return ((event.details as LandslideDetails | null)?.soilSaturation ?? 0) * 100 >= HIGH_SOIL_SATURATION_PCT;
  }
  if (event.hazardType === 'flood') {
    return ((event.details as FloodDetails | null)?.waterLevelM ?? 0) >= HIGH_WATER_LEVEL_M;
  }
  if (event.hazardType === 'wildfire') {
    return ((event.details as WildfireDetails | null)?.frpConfidence ?? 0) >= HIGH_FRP_CONFIDENCE;
  }
  return false;
}

// Used by useOngoingHazardAlerts to keep re-surfacing the evacuation popup
// for hazards that are still within the active window, not just the instant
// they're first detected.
export function isOngoingHighSeverityHazardEvent(event: HazardEvent): boolean {
  if (!isHighSeverityHazardEvent(event)) return false;
  const ageMs = Date.now() - new Date(event.eventTime).getTime();
  return ageMs >= 0 && ageMs <= ONGOING_WINDOW_HOURS * 60 * 60 * 1000;
}
