import type { Freshness } from '../rainfall.enums';
import {
  compassPoint,
  encodeDirection,
  towardDeg,
  vectorMeanWind,
  windToUv,
  type CompassPoint,
} from './wind';

/**
 * Pure feature generation over a district's stored hourly samples. Every
 * aggregate reports its completeness; an accumulation over a window with
 * missing hours is never presented as the full total.
 *
 * Nothing here scores risk or classifies rainfall as "heavy" — that is
 * Milestone 3/4 and needs thresholds with a stated basis. These are the
 * descriptive inputs those models will consume.
 */

const HOUR_MS = 60 * 60 * 1000;
export const ACCUMULATION_WINDOWS_HOURS = [1, 3, 6, 24, 72, 168] as const;
// Wind summaries average the last few hours: one model hour is noisy.
const WIND_MEAN_HOURS = 3;
const PRESSURE_TENDENCY_HOURS = 3;

export interface HourlyValues {
  validTime: Date;
  precipitationMm: number | null;
  windSpeed10mKmh: number | null;
  windFrom10mDeg: number | null;
  windSpeed850hPaKmh: number | null;
  windFrom850hPaDeg: number | null;
  windSpeed700hPaKmh: number | null;
  windFrom700hPaDeg: number | null;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  surfacePressureHpa: number | null;
  soilMoisture9To27cmM3m3: number | null;
  qualityFlags: string[];
}

export interface Accumulation {
  windowHours: number;
  /** Sum over the full window; null unless every hour is present. */
  totalMm: number | null;
  /** Sum over the hours that ARE present (a lower bound when incomplete). */
  availableMm: number;
  hoursAvailable: number;
  hoursExpected: number;
  complete: boolean;
}

export interface WindLevelFeatures {
  level: '10m' | '850hPa' | '700hPa';
  latest: {
    speedKmh: number;
    fromDeg: number;
    towardDeg: number;
    compassFrom: CompassPoint;
    u: number;
    v: number;
    sin: number;
    cos: number;
  } | null;
  /** Vector mean over the last WIND_MEAN_HOURS hours. */
  mean3h: {
    speedKmh: number;
    fromDeg: number | null;
    towardDeg: number | null;
    steadiness: number;
    hours: number;
  } | null;
}

export interface RainfallFeatures {
  asOf: string;
  accumulations: Accumulation[];
  intensity: {
    latestHourMm: number | null;
    maxHourly3hMm: number | null;
    maxHourly24hMm: number | null;
    /** Last 3 h minus the 3 h before; null if either window is incomplete. */
    change3hMm: number | null;
  };
  wind: WindLevelFeatures[];
  atmosphere: {
    temperatureC: number | null;
    relativeHumidityPct: number | null;
    surfacePressureHpa: number | null;
    pressureTendency3hHpa: number | null;
  };
  soilMoisture9To27cmM3m3: number | null;
}

export interface DataQualitySummary {
  latestValidTime: string | null;
  dataAgeMinutes: number | null;
  freshness: Freshness;
  missingHours24h: string[];
  /** Distinct quality flags over the last 24 h, with counts. */
  flags24h: Record<string, number>;
}

/** Sorted ascending, one sample per hour (later duplicates dropped). */
function byHour(samples: HourlyValues[]): Map<number, HourlyValues> {
  const map = new Map<number, HourlyValues>();
  for (const sample of samples) {
    const key = sample.validTime.getTime();
    if (!map.has(key)) map.set(key, sample);
  }
  return map;
}

function hoursEndingAt(end: Date, count: number): number[] {
  return Array.from(
    { length: count },
    (_, i) => end.getTime() - (count - 1 - i) * HOUR_MS,
  );
}

export function accumulate(
  samples: HourlyValues[],
  end: Date,
  windowHours: number,
): Accumulation {
  const hours = byHour(samples);
  let availableMm = 0;
  let hoursAvailable = 0;
  for (const t of hoursEndingAt(end, windowHours)) {
    const mm = hours.get(t)?.precipitationMm;
    if (mm === null || mm === undefined) continue;
    availableMm += mm;
    hoursAvailable += 1;
  }
  const complete = hoursAvailable === windowHours;
  const round = (mm: number) => Math.round(mm * 100) / 100;
  return {
    windowHours,
    totalMm: complete ? round(availableMm) : null,
    availableMm: round(availableMm),
    hoursAvailable,
    hoursExpected: windowHours,
    complete,
  };
}

export function missingHours(
  samples: HourlyValues[],
  end: Date,
  windowHours: number,
): string[] {
  const hours = byHour(samples);
  return hoursEndingAt(end, windowHours)
    .filter((t) => !hours.has(t))
    .map((t) => new Date(t).toISOString());
}

/**
 * Freshness relative to the ingestion cadence: right after a run the
 * newest stored hour is < 1 h old, and it legitimately ages by one
 * interval before the next run. "aging" = one run missed; "stale" = more.
 */
export function classifyFreshness(
  dataAgeMinutes: number,
  ingestionIntervalMs: number,
): Freshness {
  const intervalMinutes = ingestionIntervalMs / 60_000;
  if (dataAgeMinutes <= intervalMinutes + 60) return 'fresh';
  if (dataAgeMinutes <= 2 * intervalMinutes + 60) return 'aging';
  return 'stale';
}

function windLevel(
  samples: HourlyValues[],
  end: Date,
  level: WindLevelFeatures['level'],
  pick: (s: HourlyValues) => { speed: number | null; from: number | null },
): WindLevelFeatures {
  const hours = byHour(samples);
  const latestSample = hours.get(end.getTime());
  const latestPick = latestSample ? pick(latestSample) : null;
  const latest =
    latestPick && latestPick.speed !== null && latestPick.from !== null
      ? {
          speedKmh: latestPick.speed,
          fromDeg: latestPick.from,
          towardDeg: towardDeg(latestPick.from),
          compassFrom: compassPoint(latestPick.from),
          ...windToUv(latestPick.speed, latestPick.from),
          ...encodeDirection(latestPick.from),
        }
      : null;

  const readings = hoursEndingAt(end, WIND_MEAN_HOURS).flatMap((t) => {
    const sample = hours.get(t);
    if (!sample) return [];
    const { speed, from } = pick(sample);
    return speed !== null && from !== null
      ? [{ speedKmh: speed, fromDeg: from }]
      : [];
  });
  const mean = vectorMeanWind(readings);
  return {
    level,
    latest,
    mean3h: mean
      ? {
          speedKmh: mean.speedKmh,
          fromDeg: mean.fromDeg,
          towardDeg: mean.fromDeg === null ? null : towardDeg(mean.fromDeg),
          steadiness: mean.steadiness,
          hours: readings.length,
        }
      : null,
  };
}

/** `end` is the hour the features describe — normally the latest sample. */
export function buildRainfallFeatures(
  samples: HourlyValues[],
  end: Date,
): RainfallFeatures {
  const hours = byHour(samples);
  const at = (offsetHours: number) =>
    hours.get(end.getTime() - offsetHours * HOUR_MS);
  const latest = at(0);

  const precipitationIn = (count: number, offset = 0) =>
    hoursEndingAt(new Date(end.getTime() - offset * HOUR_MS), count).map(
      (t) => hours.get(t)?.precipitationMm ?? null,
    );
  const maxOf = (values: Array<number | null>) => {
    const present = values.filter((v): v is number => v !== null);
    return present.length ? Math.max(...present) : null;
  };
  const sumIfComplete = (values: Array<number | null>) =>
    values.every((v) => v !== null)
      ? (values as number[]).reduce((a, b) => a + b, 0)
      : null;

  const last3 = sumIfComplete(precipitationIn(3));
  const prev3 = sumIfComplete(precipitationIn(3, 3));
  const pressureNow = latest?.surfacePressureHpa ?? null;
  const pressureBefore = at(PRESSURE_TENDENCY_HOURS)?.surfacePressureHpa;

  return {
    asOf: end.toISOString(),
    accumulations: ACCUMULATION_WINDOWS_HOURS.map((w) =>
      accumulate(samples, end, w),
    ),
    intensity: {
      latestHourMm: latest?.precipitationMm ?? null,
      maxHourly3hMm: maxOf(precipitationIn(3)),
      maxHourly24hMm: maxOf(precipitationIn(24)),
      change3hMm:
        last3 !== null && prev3 !== null
          ? Math.round((last3 - prev3) * 100) / 100
          : null,
    },
    wind: [
      windLevel(samples, end, '10m', (s) => ({
        speed: s.windSpeed10mKmh,
        from: s.windFrom10mDeg,
      })),
      windLevel(samples, end, '850hPa', (s) => ({
        speed: s.windSpeed850hPaKmh,
        from: s.windFrom850hPaDeg,
      })),
      windLevel(samples, end, '700hPa', (s) => ({
        speed: s.windSpeed700hPaKmh,
        from: s.windFrom700hPaDeg,
      })),
    ],
    atmosphere: {
      temperatureC: latest?.temperatureC ?? null,
      relativeHumidityPct: latest?.relativeHumidityPct ?? null,
      surfacePressureHpa: pressureNow,
      pressureTendency3hHpa:
        pressureNow !== null &&
        pressureBefore !== null &&
        pressureBefore !== undefined
          ? Math.round((pressureNow - pressureBefore) * 10) / 10
          : null,
    },
    soilMoisture9To27cmM3m3: latest?.soilMoisture9To27cmM3m3 ?? null,
  };
}

export function summarizeDataQuality(
  samples: HourlyValues[],
  now: Date,
  ingestionIntervalMs: number,
): DataQualitySummary {
  if (samples.length === 0) {
    return {
      latestValidTime: null,
      dataAgeMinutes: null,
      freshness: 'stale',
      missingHours24h: [],
      flags24h: {},
    };
  }
  const latest = samples.reduce((a, b) =>
    b.validTime.getTime() > a.validTime.getTime() ? b : a,
  ).validTime;
  const dataAgeMinutes = Math.max(
    0,
    Math.round((now.getTime() - latest.getTime()) / 60_000),
  );
  const windowStart = latest.getTime() - 24 * HOUR_MS;
  const flags24h: Record<string, number> = {};
  for (const sample of samples) {
    if (sample.validTime.getTime() <= windowStart) continue;
    for (const flag of sample.qualityFlags) {
      flags24h[flag] = (flags24h[flag] ?? 0) + 1;
    }
  }
  return {
    latestValidTime: latest.toISOString(),
    dataAgeMinutes,
    freshness: classifyFreshness(dataAgeMinutes, ingestionIntervalMs),
    missingHours24h: missingHours(samples, latest, 24),
    flags24h,
  };
}
