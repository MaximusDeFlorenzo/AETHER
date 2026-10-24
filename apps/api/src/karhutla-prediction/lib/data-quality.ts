/**
 * Input freshness/coverage checks for one cluster forecast. These never
 * "fix" data — they classify it, so the API and UI can warn and the
 * engines can refuse horizons the inputs don't support.
 */

export type Freshness = 'fresh' | 'aging' | 'stale';

// MODIS (Terra/Aqua) plus VIIRS (S-NPP/NOAA-20/NOAA-21) are all polar
// orbiters clustered around ~10:30/13:30 and ~22:30/01:30 local overpasses,
// leaving multi-hour gaps over Indonesia, so a 6 h old detection is normal; past 12 h the fire may well have changed; past 24 h
// the engines produce nothing (see ai-engine spread.py/smoke.py).
export const HOTSPOT_FRESH_HOURS = 6;
export const HOTSPOT_STALE_HOURS = 24;
// Weather pulled from cache/provider more than this long before issuedAt
// means a forecast run with a stale model cycle.
export const WEATHER_STALE_MINUTES = 90;

export interface DataQualityInput {
  issuedAt: Date;
  latestHotspotAt: Date;
  weatherRetrievedAt: Date | null;
  surfaceWeatherTimes: Date[];
  atmosphereGridPoints: number;
  atmosphereGridPointsRequested: number;
  terrainAvailable: boolean;
  maxHorizonHours: number;
}

export interface DataQuality {
  hotspotAgeHours: number;
  hotspotFreshness: Freshness;
  weatherAgeMinutes: number | null;
  weatherCoverage: {
    firstHour: string | null;
    lastHour: string | null;
    coversObservationToMaxHorizon: boolean;
  };
  atmosphereGridCoverage: number;
  terrainAvailable: boolean;
  issues: string[];
}

export function classifyHotspotAge(ageHours: number): Freshness {
  if (ageHours <= HOTSPOT_FRESH_HOURS) return 'fresh';
  if (ageHours <= HOTSPOT_STALE_HOURS) return 'aging';
  return 'stale';
}

export function assessDataQuality(input: DataQualityInput): DataQuality {
  const issues: string[] = [];
  const hotspotAgeHours = Math.max(
    0,
    (input.issuedAt.getTime() - input.latestHotspotAt.getTime()) / 3_600_000,
  );
  const hotspotFreshness = classifyHotspotAge(hotspotAgeHours);
  if (hotspotFreshness === 'aging') {
    issues.push(`Newest hotspot is ${hotspotAgeHours.toFixed(1)} h old.`);
  } else if (hotspotFreshness === 'stale') {
    issues.push(
      `Newest hotspot is ${hotspotAgeHours.toFixed(1)} h old — too old to forecast from.`,
    );
  }

  const weatherAgeMinutes = input.weatherRetrievedAt
    ? Math.max(
        0,
        (input.issuedAt.getTime() - input.weatherRetrievedAt.getTime()) /
          60_000,
      )
    : null;
  if (weatherAgeMinutes === null) {
    issues.push('No surface weather available at the fire location.');
  } else if (weatherAgeMinutes > WEATHER_STALE_MINUTES) {
    issues.push(
      `Weather data was retrieved ${Math.round(weatherAgeMinutes)} min before this run.`,
    );
  }

  const times = [...input.surfaceWeatherTimes].sort(
    (a, b) => a.getTime() - b.getTime(),
  );
  const first = times[0] ?? null;
  const last = times[times.length - 1] ?? null;
  const needEnd = input.issuedAt.getTime() + input.maxHorizonHours * 3_600_000;
  // One hour of slack either side: the engines match weather within ±90 min.
  const covers =
    first !== null &&
    last !== null &&
    first.getTime() <= input.latestHotspotAt.getTime() + 3_600_000 &&
    last.getTime() >= needEnd - 3_600_000;
  if (first !== null && !covers) {
    issues.push(
      'Weather series does not span observation time to the longest horizon.',
    );
  }

  const atmosphereGridCoverage = input.atmosphereGridPointsRequested
    ? input.atmosphereGridPoints / input.atmosphereGridPointsRequested
    : 0;
  if (atmosphereGridCoverage < 1) {
    issues.push(
      `Wind grid incomplete (${input.atmosphereGridPoints}/${input.atmosphereGridPointsRequested} points).`,
    );
  }
  if (!input.terrainAvailable)
    issues.push('Terrain elevation unavailable; slope not applied.');

  return {
    hotspotAgeHours: Number(hotspotAgeHours.toFixed(2)),
    hotspotFreshness,
    weatherAgeMinutes:
      weatherAgeMinutes === null ? null : Math.round(weatherAgeMinutes),
    weatherCoverage: {
      firstHour: first?.toISOString() ?? null,
      lastHour: last?.toISOString() ?? null,
      coversObservationToMaxHorizon: covers,
    },
    atmosphereGridCoverage: Number(atmosphereGridCoverage.toFixed(3)),
    terrainAvailable: input.terrainAvailable,
    issues,
  };
}
