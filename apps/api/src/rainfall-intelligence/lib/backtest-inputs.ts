import { addDays, isoDay } from './gsmap-archive';

/**
 * Input assembly for the Milestone 7 hazard backtest
 * (docs/RAINFALL_INTELLIGENCE.md §10). Pure functions; the service is
 * RainfallHazardBacktestService.
 */

const HOUR_MS = 60 * 60 * 1000;
// Days of archive read before each chunk's first local day: the 72 h
// trigger window plus up to 9 h of time-zone offset (WIT), rounded up.
export const BACKTEST_LEAD_DAYS = 5;

/**
 * Whole-hour UTC offset of a district's civil time from the first two
 * digits of its Kemendagri code (the province). Keppres No. 41/1987:
 * WIB (+7) Sumatra, Java, West and Central Kalimantan; WITA (+8) Bali,
 * Nusa Tenggara, South / East / North Kalimantan, Sulawesi; WIT (+9)
 * Maluku and Papua. Null for an unknown province code.
 */
export function utcOffsetForRegionCode(code: string): number | null {
  const province = Number(code.slice(0, 2));
  if (!Number.isInteger(province)) return null;
  if (
    (province >= 11 && province <= 21) ||
    (province >= 31 && province <= 36)
  ) {
    return 7;
  }
  if (province === 61 || province === 62) return 7;
  if (province >= 51 && province <= 53) return 8;
  if (province >= 63 && province <= 65) return 8;
  if (province >= 71 && province <= 76) return 8;
  if (province === 81 || province === 82) return 9;
  if (province >= 91 && province <= 96) return 9;
  return null;
}

/** [start, start + size) blocks covering `days` days. */
export function dayChunks(
  days: number,
  size: number,
): Array<{ offset: number; days: number }> {
  const chunks = [];
  for (let offset = 0; offset < days; offset += size) {
    chunks.push({ offset, days: Math.min(size, days - offset) });
  }
  return chunks;
}

export interface ArchiveDayRow {
  districtId: string;
  day: string;
  hourlyMm: Array<number | null>;
}

/**
 * Hourly rain matrix [districts x hours] (float32, NaN = missing) for the
 * UTC days [firstUtcDay, lastUtcDay]. Column j is the hour ENDING at
 * firstUtcDay + (j + 1) h; `seriesStart` is that first valid time.
 */
export function rainSeries(
  rows: ArchiveDayRow[],
  districtIndex: Map<string, number>,
  firstUtcDay: Date,
  lastUtcDay: Date,
): { values: Float32Array; hours: number; seriesStart: Date } {
  const dayCount =
    Math.round(
      (lastUtcDay.getTime() - firstUtcDay.getTime()) / (24 * HOUR_MS),
    ) + 1;
  const hours = dayCount * 24;
  const values = new Float32Array(districtIndex.size * hours).fill(NaN);
  const dayIndex = new Map<string, number>();
  for (let i = 0; i < dayCount; i++)
    dayIndex.set(isoDay(addDays(firstUtcDay, i)), i);
  for (const row of rows) {
    const p = districtIndex.get(row.districtId);
    const d = dayIndex.get(row.day);
    if (p === undefined || d === undefined) continue;
    row.hourlyMm.forEach((mm, h) => {
      if (mm !== null && Number.isFinite(mm)) {
        values[p * hours + d * 24 + h] = mm;
      }
    });
  }
  return {
    values,
    hours,
    seriesStart: new Date(firstUtcDay.getTime() + HOUR_MS),
  };
}

/** 1 where a district has a report on a local day, else 0: int8 [districts x days]. */
export function eventMatrix(
  labels: Array<{ districtId: string; localDate: string }>,
  districtIndex: Map<string, number>,
  firstDay: Date,
  days: number,
): Int8Array {
  const out = new Int8Array(districtIndex.size * days);
  for (const label of labels) {
    const p = districtIndex.get(label.districtId);
    if (p === undefined) continue;
    const d = Math.round(
      (Date.parse(`${label.localDate}T00:00:00Z`) - firstDay.getTime()) /
        (24 * HOUR_MS),
    );
    if (d >= 0 && d < days) out[p * days + d] = 1;
  }
  return out;
}

export function float32ToBase64(values: Float32Array): string {
  return Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  ).toString('base64');
}

export function int8ToBase64(values: Int8Array): string {
  return Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  ).toString('base64');
}
