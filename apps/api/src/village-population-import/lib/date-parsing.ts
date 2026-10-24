export interface ParsedDate {
  /** ISO 8601 date (YYYY-MM-DD), for storage — never a confirmed
   * statistical period, just the date the source reported this row as of. */
  value: string | null;
  error: string | null;
}

const STRICT_DDMMYYYY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Strict DD/MM/YYYY — rejects both malformed strings and calendar-invalid
 * dates (e.g. 31/02/2020) via a UTC round-trip check, since `Date`
 * otherwise silently rolls invalid day/month combinations over into the
 * next month. Empty is treated as "not reported", not an error — this
 * column's absence doesn't invalidate the row, per empty-vs-invalid
 * being different problems throughout this importer. */
export function parseStrictDate(raw: string | undefined): ParsedDate {
  if (raw === undefined || raw.trim() === '') {
    return { value: null, error: null };
  }
  const trimmed = raw.trim();
  const match = STRICT_DDMMYYYY.exec(trimmed);
  if (!match) {
    return {
      value: null,
      error: `Tanggal "${trimmed}" bukan format DD/MM/YYYY`,
    };
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!roundTrips) {
    return {
      value: null,
      error: `Tanggal "${trimmed}" tidak valid di kalender`,
    };
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { value: iso, error: null };
}
