/**
 * JAXA GSMaP_Gauge standard (ver. 8) hourly archive — file layout and
 * selection (docs/RAINFALL_INTELLIGENCE.md, Milestone 7). Per JAXA
 * "Data Format Description for GSMaP_MVK / GSMaP_Gauge ver. 8"
 * (/standard/v8/doc/DataFormatDescription_MVK_RNL_v8.0000.pdf, §3–4):
 *
 * - /standard/v8/hourly_G/YYYY/MM/DD/gsmap_gauge.YYYYMMDD.HH00.vP.RSKI.J.dat.gz
 * - same 3600 × 1200 little-endian float32 grid as GSMaP_NOW (lib/gsmap.ts),
 *   so the same point sampler applies;
 * - the value is the rain rate averaged over HH:00–HH:59 UTC ("12:00–12:59Z
 *   for 12Z data"), so the hour's accumulation in mm, and the file time is
 *   the window START, as for GSMaP_NOW;
 * - gauge-calibrated against the NOAA CPC daily gauge analysis; published
 *   with ~3 days latency.
 */

export const GSMAP_ARCHIVE_PRODUCT = 'gsmap_gauge_v8';
export const GSMAP_ARCHIVE_ROOT = '/standard/v8/hourly_G';
// "Data is in operation with three days latency" (format description §2.2).
export const GSMAP_ARCHIVE_LATENCY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of a UTC midnight Date. */
export function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return isoDay(d) === value ? d : null;
}

export function addDays(day: Date, n: number): Date {
  return new Date(day.getTime() + n * DAY_MS);
}

export function archiveDayDir(day: Date): string {
  return `${GSMAP_ARCHIVE_ROOT}/${day.getUTCFullYear()}/${pad(day.getUTCMonth() + 1)}/${pad(day.getUTCDate())}`;
}

export interface ArchiveFile {
  name: string;
  hour: number;
  /** "v8.1000.0": algorithm version P.RSKI and reprocessing number J. */
  version: string;
}

/**
 * The file to use for each UTC hour of `day` (index 0–23, null if none).
 * When JAXA has reprocessed an hour, the highest version wins.
 */
export function pickArchiveFiles(
  names: string[],
  day: Date,
): Array<ArchiveFile | null> {
  const stamp = `${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}`;
  const byHour: Array<ArchiveFile | null> = Array.from(
    { length: 24 },
    () => null,
  );
  for (const name of names) {
    const match =
      /^gsmap_gauge\.(\d{8})\.(\d{2})00\.(v\d+\.\d{4}\.\d+)\.dat\.gz$/.exec(
        name,
      );
    if (!match || match[1] !== stamp) continue;
    const hour = Number(match[2]);
    if (hour > 23) continue;
    const current = byHour[hour];
    if (!current || compareVersions(match[3], current.version) > 0) {
      byHour[hour] = { name, hour, version: match[3] };
    }
  }
  return byHour;
}

function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.slice(1).split('.').map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Newest UTC day the archive can be expected to hold at `now`. */
export function latestArchiveDay(now: Date): Date {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return addDays(today, -GSMAP_ARCHIVE_LATENCY_DAYS);
}
