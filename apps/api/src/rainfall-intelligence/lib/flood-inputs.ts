import { haversineKm } from '../../karhutla-prediction/lib/geo';
import type { Freshness } from '../rainfall.enums';
import {
  accumulate,
  summarizeDataQuality,
  type HourlyValues,
} from './features';
import type { RainfallSourcePriority } from './trailing-rainfall';

/**
 * Pure assembly of the flood-risk engine's per-district inputs
 * (docs/RAINFALL_INTELLIGENCE.md, Milestone 3) from stored data. Nothing
 * here scores risk: it picks a rainfall series, measures its completeness
 * and freshness, and attaches susceptibility and gauge context with their
 * sources.
 */

const HOUR_MS = 60 * 60 * 1000;
const TRIGGER_WINDOWS = [1, 3, 6, 24] as const;
const ANTECEDENT_WINDOWS = [72, 168] as const;
// Fewer valid districts than this and terciles say nothing national.
export const MIN_DISTRICTS_FOR_TERCILES = 30;

export interface SampleRow {
  validTime: Date;
  precipitationMm: number | null;
  soilMoisture9To27cmM3m3?: number | null;
}

export interface FloodRainfallIn {
  source: string;
  dataKind: string;
  validTime: string;
  freshness: Freshness;
  maxHourlyMmLast3Hours: number | null;
  accumulationsMm: Record<string, number | null>;
}

export interface FloodAntecedentIn {
  source: string;
  dataKind: string;
  validTime: string;
  totalMm72Hours: number | null;
  totalMm168Hours: number | null;
}

export interface FloodSoilMoistureIn {
  source: string;
  validTime: string;
  volumetricFraction: number;
}

export interface FloodGaugeIn {
  source: string;
  name: string;
  alertLevel: number;
  observedAt: string;
  distanceKm: number;
}

export interface FloodPointIn {
  id: string;
  rainfall?: FloodRainfallIn;
  antecedent?: FloodAntecedentIn;
  soilMoisture?: FloodSoilMoistureIn;
  susceptibility?: { source: string; floodHazardIndex: number | null };
  gauge?: FloodGaugeIn;
}

interface SeriesState {
  priority: RainfallSourcePriority;
  rows: HourlyValues[];
  latest: Date;
  freshness: Freshness;
}

function toHourly(rows: SampleRow[]): HourlyValues[] {
  return rows.map(
    (row) =>
      ({
        qualityFlags: [],
        ...row,
        soilMoisture9To27cmM3m3: row.soilMoisture9To27cmM3m3 ?? null,
      }) as unknown as HourlyValues,
  );
}

function seriesStates(
  rowsBySource: Map<string, SampleRow[]>,
  priorities: RainfallSourcePriority[],
  now: Date,
): SeriesState[] {
  return priorities.flatMap((priority) => {
    const rows = toHourly(rowsBySource.get(priority.source) ?? []);
    const quality = summarizeDataQuality(
      rows,
      now,
      priority.ingestionIntervalMs,
    );
    if (!quality.latestValidTime) return [];
    return [
      {
        priority,
        rows,
        latest: new Date(quality.latestValidTime),
        freshness: quality.freshness,
      },
    ];
  });
}

/**
 * Trigger rainfall from ONE series, so the hourly peak and the 24 h total
 * describe the same data. Order of preference: the first non-stale series
 * with a complete 24 h window; else the first non-stale series (hourly
 * peak only); else the first series at all, passed as stale so the engine
 * records why it refused.
 */
export function selectFloodRainfall(
  rowsBySource: Map<string, SampleRow[]>,
  priorities: RainfallSourcePriority[],
  now: Date,
): FloodRainfallIn | undefined {
  const states = seriesStates(rowsBySource, priorities, now);
  const usable = states.filter((s) => s.freshness !== 'stale');
  const chosen =
    usable.find((s) => accumulate(s.rows, s.latest, 24).complete) ??
    usable[0] ??
    states[0];
  if (!chosen) return undefined;

  const last3 = [0, 1, 2]
    .map(
      (offset) =>
        chosen.rows.find(
          (r) =>
            r.validTime.getTime() ===
            chosen.latest.getTime() - offset * HOUR_MS,
        )?.precipitationMm,
    )
    .filter((mm): mm is number => mm !== null && mm !== undefined);
  return {
    source: chosen.priority.source,
    dataKind: chosen.priority.dataKind,
    validTime: chosen.latest.toISOString(),
    freshness: chosen.freshness,
    // A lower bound when an hour is missing — still enough to say a
    // category threshold WAS crossed.
    maxHourlyMmLast3Hours: last3.length ? Math.max(...last3) : null,
    accumulationsMm: Object.fromEntries(
      TRIGGER_WINDOWS.map((w) => [
        String(w),
        accumulate(chosen.rows, chosen.latest, w).totalMm,
      ]),
    ),
  };
}

/** Antecedent totals from the first non-stale series with a complete 72 h
 * window (GSMaP qualifies once a week of it has been stored). */
export function selectAntecedentRainfall(
  rowsBySource: Map<string, SampleRow[]>,
  priorities: RainfallSourcePriority[],
  now: Date,
): FloodAntecedentIn | undefined {
  const chosen = seriesStates(rowsBySource, priorities, now).find(
    (s) =>
      s.freshness !== 'stale' &&
      accumulate(s.rows, s.latest, ANTECEDENT_WINDOWS[0]).complete,
  );
  if (!chosen) return undefined;
  const total = (w: number) =>
    accumulate(chosen.rows, chosen.latest, w).totalMm;
  return {
    source: chosen.priority.source,
    dataKind: chosen.priority.dataKind,
    validTime: chosen.latest.toISOString(),
    totalMm72Hours: total(72),
    totalMm168Hours: total(168),
  };
}

/** Newest non-null model soil moisture from a non-stale series. */
export function selectSoilMoisture(
  rowsBySource: Map<string, SampleRow[]>,
  priorities: RainfallSourcePriority[],
  now: Date,
): FloodSoilMoistureIn | undefined {
  for (const state of seriesStates(rowsBySource, priorities, now)) {
    if (state.freshness === 'stale') continue;
    const latest = [...state.rows]
      .filter((r) => r.soilMoisture9To27cmM3m3 !== null)
      .sort((a, b) => b.validTime.getTime() - a.validTime.getTime())[0];
    if (latest && latest.soilMoisture9To27cmM3m3 !== null) {
      return {
        source: state.priority.source,
        validTime: latest.validTime.toISOString(),
        volumetricFraction: latest.soilMoisture9To27cmM3m3,
      };
    }
  }
  return undefined;
}

/** Linear-interpolated quantile of an ascending array. */
function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * National terciles of a hazard index across districts — the class breaks
 * InaRISK itself doesn't publish (its legend is a 0–1 stretch). Null with
 * too few districts to call the split national.
 */
export function nationalTerciles(values: number[]): [number, number] | null {
  const valid = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (valid.length < MIN_DISTRICTS_FOR_TERCILES) return null;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return [round(quantile(valid, 1 / 3)), round(quantile(valid, 2 / 3))];
}

const SIAGA_LEVELS: Record<string, number> = { IV: 4, III: 3, II: 2, I: 1 };

/** "SIAGA III" → 3. Null for anything that isn't an official Siaga label. */
export function parseSiagaLevel(
  label: string | null | undefined,
): number | null {
  const match = /\bSIAGA\s*(IV|III|II|I)\b/i.exec(label ?? '');
  return match ? SIAGA_LEVELS[match[1].toUpperCase()] : null;
}

export interface GaugeReading {
  source: string;
  name: string;
  latitude: number;
  longitude: number;
  alertLevel: number;
  observedAt: Date;
}

/**
 * Each gauge informs only the district whose reference point is nearest
 * (no watershed polygons exist to do better), and only within `maxKm`.
 * Per district, the most severe status wins; ties go to the nearer gauge.
 */
export function assignGaugesToDistricts(
  gauges: GaugeReading[],
  districts: Array<{ id: string; latitude: number; longitude: number }>,
  maxKm: number,
): Map<string, FloodGaugeIn> {
  const byDistrict = new Map<string, FloodGaugeIn>();
  for (const gauge of gauges) {
    let nearest: { id: string; km: number } | null = null;
    for (const district of districts) {
      const km = haversineKm(
        gauge.latitude,
        gauge.longitude,
        district.latitude,
        district.longitude,
      );
      if (!nearest || km < nearest.km) nearest = { id: district.id, km };
    }
    if (!nearest || nearest.km > maxKm) continue;
    const candidate: FloodGaugeIn = {
      source: gauge.source,
      name: gauge.name,
      alertLevel: gauge.alertLevel,
      observedAt: gauge.observedAt.toISOString(),
      distanceKm: Math.round(nearest.km * 10) / 10,
    };
    const current = byDistrict.get(nearest.id);
    if (
      !current ||
      candidate.alertLevel < current.alertLevel ||
      (candidate.alertLevel === current.alertLevel &&
        candidate.distanceKm < current.distanceKm)
    ) {
      byDistrict.set(nearest.id, candidate);
    }
  }
  return byDistrict;
}

/** The district point plus four neighbours `offsetDeg` N/S/E/W. */
export function hazardSamplePoints(
  latitude: number,
  longitude: number,
  offsetDeg: number,
): Array<{ latitude: number; longitude: number }> {
  return [
    { latitude, longitude },
    { latitude: latitude + offsetDeg, longitude },
    { latitude: latitude - offsetDeg, longitude },
    { latitude, longitude: longitude + offsetDeg },
    { latitude, longitude: longitude - offsetDeg },
  ];
}

/** InaRISK indices are 0–1; anything else (e.g. a NoData sentinel) is
 * treated as missing. */
export function summarizeHazardSamples(raw: Array<number | null>) {
  const values = raw.map((v) =>
    v !== null && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null,
  );
  const valid = values.filter((v): v is number => v !== null);
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    valueCenter: values[0] ?? null,
    valueMean: valid.length
      ? round(valid.reduce((a, b) => a + b, 0) / valid.length)
      : null,
    valueMax: valid.length ? Math.max(...valid) : null,
    samplesTotal: values.length,
    samplesValid: valid.length,
  };
}
