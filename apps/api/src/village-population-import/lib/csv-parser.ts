import { parse as parseSync } from 'csv-parse/sync';
import { parse as parseStream } from 'csv-parse';
import { Readable } from 'node:stream';

// Canonical column order per the source format's spec (delimiter `;`,
// 12 columns). Header-mode files may reorder these; header names are
// matched against this list (whitespace/case-normalized), never guessed.
export const CANONICAL_COLUMNS = [
  'Provinsi',
  'Kabupaten/Kota',
  'Kecamatan',
  'Status',
  'Kode PUM',
  'Desa/Kelurahan',
  'Tanggal',
  'Laki-Laki',
  'Perempuan',
  'Jumlah Penduduk',
  'Jumlah KK',
  'Kepadatan (Jiwa/Km2)',
] as const;

export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

export interface CsvDataRow {
  /** 1-indexed position among DATA rows only — row 1 is always the first
   * data row, whether or not a header preceded it. This is the number
   * shown to the user. */
  rowNumber: number;
  /** Semicolon-joined raw values (quotes stripped by the parser, not by
   * string replacement) — a faithful, if re-serialized, record of what was
   * read, kept for traceability regardless of column-count problems. */
  rawLine: string;
  /** Exactly the number of raw values this physical row had — may differ
   * from 12, which callers must check before trusting `fields`. */
  columnCount: number;
  /** Present (all 12 keys) only when columnCount === 12; undefined
   * otherwise so callers can't silently misread a malformed row. */
  fields: Record<CanonicalColumn, string> | undefined;
}

export interface CsvParseOutcome {
  rows: CsvDataRow[];
}

export class CsvStructureError extends Error {}

function normalizeHeaderName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

const CANONICAL_BY_NORMALIZED_NAME = new Map(
  CANONICAL_COLUMNS.map((c) => [normalizeHeaderName(c), c]),
);

/**
 * Extracts the 12 canonical fields from a data row given where each
 * canonical column lives (`canonicalToIndex`) — correct whether that came
 * from a fixed no-header order or a header row that named columns in a
 * different order and/or included extra, ignored columns. Returns
 * undefined if the physical row is too short to have all 12 positions
 * (a genuine column-count problem, reported to the caller separately).
 */
function extractFields(
  values: string[],
  canonicalToIndex: Readonly<Record<CanonicalColumn, number>>,
): Record<CanonicalColumn, string> | undefined {
  const fields = {} as Record<CanonicalColumn, string>;
  for (const column of CANONICAL_COLUMNS) {
    const index = canonicalToIndex[column];
    if (index >= values.length) {
      return undefined;
    }
    fields[column] = values[index];
  }
  return fields;
}

const NO_HEADER_CANONICAL_TO_INDEX: Record<CanonicalColumn, number> =
  Object.fromEntries(CANONICAL_COLUMNS.map((c, i) => [c, i])) as Record<
    CanonicalColumn,
    number
  >;

/**
 * Validates a header row and returns where each canonical column lives —
 * shared by the sync and streaming parsers so header-validation rules
 * (missing/duplicate column, case/whitespace-insensitive matching, extra
 * columns ignored) can never drift between the two.
 *
 * @throws CsvStructureError for a missing or duplicated canonical column.
 */
function buildCanonicalToIndexFromHeader(
  headerRow: string[],
): Record<CanonicalColumn, number> {
  const found: Partial<Record<CanonicalColumn, number>> = {};
  headerRow.forEach((raw, index) => {
    const canonical = CANONICAL_BY_NORMALIZED_NAME.get(
      normalizeHeaderName(raw),
    );
    if (!canonical) {
      return; // extra/unrecognized header column — ignored, not an error
    }
    if (found[canonical] !== undefined) {
      throw new CsvStructureError(
        `Kolom header "${raw.trim()}" muncul lebih dari sekali`,
      );
    }
    found[canonical] = index;
  });

  const missing = CANONICAL_COLUMNS.filter((c) => found[c] === undefined);
  if (missing.length > 0) {
    throw new CsvStructureError(
      `Header tidak lengkap — kolom berikut tidak ditemukan: ${missing.join(', ')}`,
    );
  }
  return found as Record<CanonicalColumn, number>;
}

const PARSE_OPTIONS = {
  delimiter: ';',
  quote: '"',
  escape: '"',
  bom: true,
  skip_empty_lines: true,
  relax_column_count: true,
  // Outer whitespace is trimmed downstream, per value — raw_fields keeps
  // the untrimmed (but unquoted) value for traceability.
  trim: false,
} as const;

/**
 * Structural CSV parsing only — no type conversion, no region matching.
 * Buffers the WHOLE file into one array; fine for the small fixtures this
 * module's own unit tests use, but never used on a real upload (see
 * `parseCsvStream` below, which the validation worker actually calls) —
 * loading a ~100k-row file this way would hold the entire parsed file in
 * memory at once, exactly what the streaming path exists to avoid. Uses
 * `csv-parse` (RFC4180-aware: quoted values, `""`-escaped quotes, BOM,
 * CRLF/LF, embedded delimiters inside quotes) rather than `split(';')`,
 * which breaks on any of those. `relax_column_count: true` so one
 * malformed physical row doesn't abort the whole file — column-count
 * mismatches are reported per-row via `CsvDataRow.columnCount`/`fields`
 * instead of thrown.
 *
 * @throws CsvStructureError only for whole-file problems: header mode with
 *   a missing/duplicate canonical column name (nothing downstream could be
 *   trusted), or the underlying parser rejecting the byte stream outright
 *   (e.g. not valid text).
 */
export function parseCsv(
  buffer: Buffer,
  hasHeaderRow: boolean,
): CsvParseOutcome {
  let records: string[][];
  try {
    records = parseSync(buffer, PARSE_OPTIONS) as string[][];
  } catch (error) {
    throw new CsvStructureError(
      `File tidak dapat dibaca sebagai CSV: ${(error as Error).message}`,
    );
  }

  if (records.length === 0) {
    return { rows: [] };
  }

  const canonicalToIndex = hasHeaderRow
    ? buildCanonicalToIndexFromHeader(records[0])
    : NO_HEADER_CANONICAL_TO_INDEX;
  const dataRecords = hasHeaderRow ? records.slice(1) : records;
  const expectedColumnCount = hasHeaderRow
    ? records[0].length
    : CANONICAL_COLUMNS.length;

  const rows: CsvDataRow[] = dataRecords.map((values, i) => ({
    rowNumber: i + 1,
    rawLine: values.join(';'),
    columnCount: values.length,
    fields:
      values.length === expectedColumnCount
        ? extractFields(values, canonicalToIndex)
        : undefined,
  }));

  return { rows };
}

/**
 * The real parsing path for an actual upload — streams the file through
 * `csv-parse`'s Transform-stream API and yields one `CsvDataRow` at a time,
 * so the caller (the validation worker) never holds more than a small
 * working set of rows in memory regardless of file size. `input` accepts
 * either a Buffer (wrapped in a Readable) or an existing stream (e.g. a
 * StorageService download stream), so a future switch to a true streaming
 * object-storage download doesn't need this function to change.
 *
 * Same structural rules as `parseCsv` (delimiter, quoting, header
 * validation, column-count-mismatch-per-row, row 1 never discarded in
 * no-header mode) — both call the same `buildCanonicalToIndexFromHeader`/
 * `extractFields` helpers, so the two paths can't silently diverge.
 *
 * @throws CsvStructureError for the same whole-file header problems
 *   `parseCsv` throws for, surfaced on the first `for await` iteration.
 */
export async function* parseCsvStream(
  input: Buffer | NodeJS.ReadableStream,
  hasHeaderRow: boolean,
): AsyncGenerator<CsvDataRow> {
  const source = Buffer.isBuffer(input) ? Readable.from(input) : input;
  let parser;
  try {
    parser = source.pipe(parseStream(PARSE_OPTIONS));
  } catch (error) {
    throw new CsvStructureError(
      `File tidak dapat dibaca sebagai CSV: ${(error as Error).message}`,
    );
  }

  let canonicalToIndex: Record<CanonicalColumn, number> | null = null;
  let expectedColumnCount = 0;
  let isFirstRecord = true;
  let rowNumber = 0;

  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      if (isFirstRecord) {
        isFirstRecord = false;
        if (hasHeaderRow) {
          canonicalToIndex = buildCanonicalToIndexFromHeader(record);
          expectedColumnCount = record.length;
          continue; // the header row itself is never yielded as data
        }
        canonicalToIndex = NO_HEADER_CANONICAL_TO_INDEX;
        expectedColumnCount = CANONICAL_COLUMNS.length;
        // falls through to yield this row as data (row 1) below
      }

      rowNumber++;
      yield {
        rowNumber,
        rawLine: record.join(';'),
        columnCount: record.length,
        fields:
          record.length === expectedColumnCount
            ? extractFields(record, canonicalToIndex!)
            : undefined,
      };
    }
  } catch (error) {
    if (error instanceof CsvStructureError) throw error;
    throw new CsvStructureError(
      `File tidak dapat dibaca sebagai CSV: ${(error as Error).message}`,
    );
  }
}
