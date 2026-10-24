import type { Freshness } from './data-quality';
import type { ExposedPlace, HorizonExposure } from './exposure';

/**
 * Predefined, rule-based precautionary recommendations. Every item names
 * the rule and evidence that produced it (`basis`). Deliberately never
 * issues an evacuation instruction: AETHER supports, and does not replace,
 * BPBD / Manggala Agni / Satgas Karhutla decision-making.
 */

export type RecommendationAudience = 'responders' | 'public';
export type RecommendationPriority = 'info' | 'advisory' | 'priority';

export interface Recommendation {
  code: string;
  audience: RecommendationAudience;
  priority: RecommendationPriority;
  text: string;
  basis: string;
}

export interface RecommendationInput {
  hotspotFreshness: Freshness;
  hotspotAgeHours: number;
  confidence: string | null;
  spreadAvailable: boolean;
  smokeAvailable: boolean;
  exposure: HorizonExposure[];
  /** True when settlement data (OSM) could not be loaded for this cluster. */
  settlementsUnavailable: boolean;
}

const MAX_NAMES = 5;

function names(places: ExposedPlace[]): string {
  const unique = Array.from(new Set(places.map((p) => p.name)));
  const shown = unique.slice(0, MAX_NAMES).join(', ');
  return unique.length > MAX_NAMES
    ? `${shown} and ${unique.length - MAX_NAMES} more`
    : shown;
}

/** Earliest horizon at which each place appears, so a place is reported
 * once at its soonest potential exposure. */
function earliest(
  exposure: HorizonExposure[],
  pick: (h: HorizonExposure) => ExposedPlace[],
): { horizonHours: number; places: ExposedPlace[] } | null {
  const seen = new Set<string>();
  let firstHorizon: number | null = null;
  const places: ExposedPlace[] = [];
  for (const horizon of [...exposure].sort(
    (a, b) => a.horizonHours - b.horizonHours,
  )) {
    for (const place of pick(horizon)) {
      const key = `${place.source}:${place.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      firstHorizon ??= horizon.horizonHours;
      places.push(place);
    }
  }
  return firstHorizon === null ? null : { horizonHours: firstHorizon, places };
}

export function buildRecommendations(
  input: RecommendationInput,
): Recommendation[] {
  const recs: Recommendation[] = [
    {
      code: 'VERIFY_ON_GROUND',
      audience: 'responders',
      priority: 'priority',
      text: 'Verify this hotspot cluster on the ground (BPBD, Manggala Agni or Satgas Karhutla) before acting on the forecast. Satellite hotspots are thermal anomalies and can be false detections or already-extinguished fires.',
      basis:
        'Always issued: forecasts are uncalibrated and derived from satellite thermal anomalies.',
    },
  ];

  if (input.hotspotFreshness !== 'fresh') {
    recs.push({
      code: 'REFRESH_OBSERVATION',
      audience: 'responders',
      priority: 'advisory',
      text: `The newest satellite detection is ${input.hotspotAgeHours.toFixed(1)} h old. Obtain a fresh observation (next satellite pass, drone or field report) before relying on this forecast.`,
      basis: `Hotspot freshness classified "${input.hotspotFreshness}".`,
    });
  }

  if (input.confidence === 'very_low') {
    recs.push({
      code: 'DEGRADED_INPUTS',
      audience: 'responders',
      priority: 'advisory',
      text: 'Forecast inputs are incomplete or degraded (see data quality). Treat the mapped areas as indicative only.',
      basis: 'Engine confidence label "very_low".',
    });
  }

  const spreadHit = earliest(input.exposure, (h) => h.spread);
  if (spreadHit) {
    recs.push({
      code: 'SPREAD_REACHES_PLACES',
      audience: 'responders',
      priority: 'priority',
      text: `${names(spreadHit.places)} lie inside the potential spread envelope (from the ${spreadHit.horizonHours} h horizon). Consider pre-positioning firefighting resources and reviewing local preparedness and evacuation procedures with BPBD. Do not order evacuations on the basis of this model alone.`,
      basis: `Point-in-polygon of ${spreadHit.places.length} known place(s) against the upper-bound spread envelope.`,
    });
  }

  const smokeHit = earliest(input.exposure, (h) => [
    ...h.smoke.core,
    ...h.smoke.likely,
  ]);
  if (smokeHit) {
    recs.push({
      code: 'SMOKE_MAY_REACH_PLACES',
      audience: 'public',
      priority: 'advisory',
      text: `Smoke may already be over, or reach, ${names(smokeHit.places)} by the ${smokeHit.horizonHours} h forecast horizon (qualitative transport estimate; smoke has been drifting since the last satellite detection). If smoke is present: limit outdoor activity, keep windows and doors closed, and wear well-fitting N95/KN95 masks; take extra care with children, older people, pregnant women and people with heart or lung conditions. Check official air-quality (ISPU) readings and BMKG updates.`,
      basis: `Places inside the "core" or "likely" smoke transport classes (relative particle density, not concentration).`,
    });
  }

  if (
    !spreadHit &&
    !smokeHit &&
    (input.spreadAvailable || input.smokeAvailable)
  ) {
    recs.push({
      code: 'NO_KNOWN_PLACES_EXPOSED',
      audience: 'responders',
      priority: 'info',
      text: 'No known district reference location or mapped settlement falls inside the forecast areas. AETHER has no road, facility or village-boundary data, so this does not mean no one is exposed.',
      basis: 'No point-in-polygon matches.',
    });
  }

  if (input.settlementsUnavailable) {
    recs.push({
      code: 'SETTLEMENT_DATA_MISSING',
      audience: 'responders',
      priority: 'info',
      text: 'Settlement locations (OpenStreetMap) could not be loaded for this cluster; only district reference locations were checked.',
      basis: 'Settlement provider unavailable.',
    });
  }

  return recs;
}
