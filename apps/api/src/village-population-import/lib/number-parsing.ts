import { PopulationNumberFormat } from '../../common/enums/domain.enum';

export interface ParsedInt {
  value: number | null; // null = empty cell, distinct from 0
  error: string | null;
}

// Accepts EITHER plain digits ("1234") OR a properly-grouped "."
// thousands separator ("1.234", "12.345.678") — never a decimal point.
// Unlike `Kepadatan`, a population/household COUNT has no sensible
// fractional reading ("1.234 jiwa" as "1.234 people" is meaningless), so
// there is no real format ambiguity to ask the uploader to resolve here;
// "." in these four columns can only ever be absent or a thousands group.
const PLAIN_OR_THOUSANDS_INT = /^\d{1,3}(\.\d{3})+$|^\d+$/;

/** Laki-Laki / Perempuan / Jumlah Penduduk / Jumlah KK — nonnegative
 * integers, empty distinct from zero. Found live against a real ~67k-row
 * Prodeskel export (the single-row example this parser was originally
 * built from happened to have every value under 1,000, which hid this):
 * any village with 1,000+ residents or households is written with a "."
 * thousands separator here too, not just in `Kepadatan` — rejecting that
 * as "not an integer" wrongly flagged ~98% of a real national file's
 * problem rows. Still rejects an actual decimal point, sign, or any
 * other non-digit content — only a THOUSANDS grouping is accepted. */
export function parseNonNegativeInt(raw: string | undefined): ParsedInt {
  if (raw === undefined) {
    return { value: null, error: null };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null, error: null };
  }
  if (!PLAIN_OR_THOUSANDS_INT.test(trimmed)) {
    return {
      value: null,
      error: `bukan bilangan bulat nonnegatif: "${raw}"`,
    };
  }
  return {
    value: Number.parseInt(trimmed.replace(/\./g, ''), 10),
    error: null,
  };
}

export interface ParsedDensity {
  raw: string | null; // preserved exactly as the source had it (trimmed)
  converted: number | null;
  error: string | null;
}

// Matches `density_converted NUMERIC(12, 3)` on both `village_populations`
// and `village_population_import_rows` (village-population.entity.ts /
// village-population-import-row.entity.ts) — 12 total digits, 3 after the
// decimal point, so at most 9 digits before it. Found live against a real
// ~67k-row Prodeskel export: under DOT_THOUSANDS_SEPARATOR, a source value
// like "29.325.000.000" parses to 29,325,000,000 (no real place has that
// many people per km²; this is a data-quality defect in the source file
// itself, not a parsing bug) — inserting it crashed the whole batch with
// a raw Postgres "numeric field overflow", which isn't a CsvStructureError
// so the validation job retried it 3 times and failed identically every
// time before finally marking the entire batch FAILED, for the sake of
// roughly 1 in 200 rows. A value this large must be flagged on ITS OWN row
// instead — not silently clamped/rescaled (that would be exactly the
// guessing this importer's spec forbids) and not allowed to take down
// every other row in the file.
const DENSITY_MAX = 999_999_999.999;

/**
 * `Kepadatan (Jiwa/Km2)` — the one column whose source number format is
 * genuinely ambiguous (see PopulationNumberFormat's comment). Converts
 * using whichever rule the uploader explicitly chose; never guesses.
 * `raw` is always preserved as given (this function never "corrects" it).
 */
export function parseDensity(
  raw: string | undefined,
  format: PopulationNumberFormat,
): ParsedDensity {
  if (raw === undefined || raw.trim() === '') {
    return { raw: null, converted: null, error: null };
  }
  const trimmed = raw.trim();

  let converted: number;

  if (format === PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR) {
    // "26.000" -> 26000; "1.234.567" -> 1234567; "26" -> 26 (unaffected).
    // Each "." must be followed by exactly 3 digits to be a thousands
    // group — anything else means this value doesn't actually fit the
    // chosen rule, and guessing further would be exactly the silent
    // reinterpretation the spec forbids.
    if (!/^\d{1,3}(\.\d{3})*$/.test(trimmed)) {
      return {
        raw: trimmed,
        converted: null,
        error: `"${trimmed}" tidak sesuai format pemisah ribuan yang dipilih`,
      };
    }
    converted = Number(trimmed.replace(/\./g, ''));
  } else {
    // DOT_DECIMAL_POINT: "." is a literal decimal point — "26.000" -> 26.
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      return {
        raw: trimmed,
        converted: null,
        error: `"${trimmed}" tidak sesuai format desimal yang dipilih`,
      };
    }
    converted = Number(trimmed);
  }

  if (converted > DENSITY_MAX) {
    return {
      raw: trimmed,
      converted: null,
      error: `"${trimmed}" -> ${converted.toLocaleString('id-ID')} jiwa/km² — melebihi batas yang wajar/dapat disimpan, kemungkinan data sumber keliru (tidak dikoreksi otomatis)`,
    };
  }
  return { raw: trimmed, converted, error: null };
}

/** Shown in the preview UI next to the format picker so the ambiguity in
 * "26.000" is resolved by an informed, explicit choice — not a blind
 * dropdown label. */
export function densityFormatExample(format: PopulationNumberFormat): string {
  return format === PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR
    ? '"26.000" -> 26000 (26 ribu jiwa/km²)'
    : '"26.000" -> 26 (dua puluh enam koma nol jiwa/km²)';
}
