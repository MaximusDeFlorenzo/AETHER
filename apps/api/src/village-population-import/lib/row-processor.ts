import {
  PopulationImportRowStatus,
  PopulationNumberFormat,
  PopulationPeriodStatus,
} from '../../common/enums/domain.enum';
import type { CanonicalColumn, CsvDataRow } from './csv-parser';
import { parseDensity, parseNonNegativeInt } from './number-parsing';
import { parseStrictDate } from './date-parsing';
import {
  normalizeKodePum,
  normalizeRegionName,
  normalizePlainRegionName,
  regionNamesMatch,
} from './code-normalization';
import { computeDedupeKey } from './dedupe-key';

export interface VillageIndexEntry {
  id: string;
  code: string;
  name: string;
  subdistrictName: string;
  districtName: string;
  provinceName: string;
}

export interface VillageLookup {
  /** `village.code` ("11.09.07.2008") -> entry. */
  byCode: Map<string, VillageIndexEntry>;
  /** Normalized "provinsi|kabupaten|kecamatan|desa" -> candidate entries
   * (a name collision across regions is possible, hence an array — the
   * caller must not auto-pick one). */
  byHierarchy: Map<string, VillageIndexEntry[]>;
}

// District position uses the KAB/KABUPATEN/KOTA-stripping normalizer;
// province/subdistrict/village use the plain one — see
// `normalizePlainRegionName`'s comment for why (a literal "Kota" in a
// kecamatan/kelurahan name must not be stripped). Both sides that build
// this key (this function, from CSV row text, and `village-lookup.ts`,
// from the DB) must apply the identical per-position normalizer or the
// keys can never match.
export function buildHierarchyKey(
  province: string,
  district: string,
  subdistrict: string,
  village: string,
): string {
  return [
    normalizePlainRegionName(province),
    normalizeRegionName(district),
    normalizePlainRegionName(subdistrict),
    normalizePlainRegionName(village),
  ].join('|');
}

export interface ProcessedRow {
  rowNumber: number;
  rawLine: string;
  columnCount: number;
  rawFields: Record<CanonicalColumn, string> | null;
  kodePum: string | null;
  normalizedCode: string | null;
  matchedVillageId: string | null;
  candidateVillageIds: string[]; // populated only for NEEDS_REVIEW
  parsedDateRaw: string | null;
  parsedDate: string | null;
  male: number | null;
  female: number | null;
  totalPopulation: number | null;
  households: number | null;
  densityRaw: string | null;
  densityConverted: number | null;
  status: PopulationImportRowStatus;
  messages: string[];
  dedupeKey: string;
}

export interface RowProcessingSettings {
  numberFormat: PopulationNumberFormat;
  periodStatus: PopulationPeriodStatus;
  periodYear: number | null;
  sourceName: string;
}

/**
 * Pure per-row pipeline: structural fields -> typed values -> region match
 * -> dedupe key. No DB access (the `lookup` table is prebuilt once by the
 * caller from a real repository query) and no I/O, so every branch here is
 * unit-testable without a database.
 */
export function processRow(
  row: CsvDataRow,
  lookup: VillageLookup,
  settings: RowProcessingSettings,
): ProcessedRow {
  const messages: string[] = [];
  const dedupeKey = computeDedupeKey({
    periodStatus: settings.periodStatus,
    periodYear: settings.periodYear,
    reportedDate: null, // filled in below once parsedDate is known, if unknown-period
    sourceName: settings.sourceName,
  });

  if (!row.fields) {
    return {
      rowNumber: row.rowNumber,
      rawLine: row.rawLine,
      columnCount: row.columnCount,
      rawFields: null,
      kodePum: null,
      normalizedCode: null,
      matchedVillageId: null,
      candidateVillageIds: [],
      parsedDateRaw: null,
      parsedDate: null,
      male: null,
      female: null,
      totalPopulation: null,
      households: null,
      densityRaw: null,
      densityConverted: null,
      status: PopulationImportRowStatus.INVALID,
      messages: [
        `Jumlah kolom ${row.columnCount}, diharapkan 12 — baris dilewati`,
      ],
      dedupeKey,
    };
  }

  const f = row.fields;

  const male = parseNonNegativeInt(f['Laki-Laki']);
  const female = parseNonNegativeInt(f['Perempuan']);
  const total = parseNonNegativeInt(f['Jumlah Penduduk']);
  const households = parseNonNegativeInt(f['Jumlah KK']);
  const density = parseDensity(
    f['Kepadatan (Jiwa/Km2)'],
    settings.numberFormat,
  );
  const date = parseStrictDate(f['Tanggal']);
  const kodePumRaw = f['Kode PUM']?.trim() || null;
  const normalizedKode = normalizeKodePum(f['Kode PUM']);

  for (const [label, parsed] of [
    ['Laki-Laki', male],
    ['Perempuan', female],
    ['Jumlah Penduduk', total],
    ['Jumlah KK', households],
  ] as const) {
    if (parsed.error) messages.push(`${label}: ${parsed.error}`);
  }
  if (density.error) messages.push(`Kepadatan: ${density.error}`);
  if (date.error) messages.push(date.error);
  if (normalizedKode.error) messages.push(normalizedKode.error);

  const sumMismatch =
    male.value !== null &&
    female.value !== null &&
    total.value !== null &&
    male.value + female.value !== total.value;
  if (sumMismatch) {
    messages.push(
      `Laki-Laki + Perempuan (${male.value! + female.value!}) tidak sama dengan Jumlah Penduduk (${total.value}) — ditandai, tidak dikoreksi otomatis`,
    );
  }

  const finalDedupeKey =
    settings.periodStatus === PopulationPeriodStatus.UNKNOWN
      ? computeDedupeKey({
          periodStatus: settings.periodStatus,
          periodYear: settings.periodYear,
          reportedDate: date.value,
          sourceName: settings.sourceName,
        })
      : dedupeKey;

  const hasFieldError = Boolean(
    male.error ||
    female.error ||
    total.error ||
    households.error ||
    density.error ||
    date.error ||
    sumMismatch,
  );

  const base = {
    rowNumber: row.rowNumber,
    rawLine: row.rawLine,
    columnCount: row.columnCount,
    rawFields: f,
    kodePum: kodePumRaw,
    normalizedCode: normalizedKode.normalized,
    parsedDateRaw: f['Tanggal']?.trim() || null,
    parsedDate: date.value,
    male: male.value,
    female: female.value,
    totalPopulation: total.value,
    households: households.value,
    densityRaw: density.raw,
    densityConverted: density.converted,
    dedupeKey: finalDedupeKey,
  };

  // Region matching: code first, hierarchy fallback only when no code was
  // supplied at all — never a fuzzy fallback for a code that IS present
  // but doesn't resolve.
  if (kodePumRaw !== null) {
    if (!normalizedKode.normalized) {
      return {
        ...base,
        matchedVillageId: null,
        candidateVillageIds: [],
        status: PopulationImportRowStatus.INVALID,
        messages,
      };
    }
    const matched = lookup.byCode.get(normalizedKode.normalized);
    if (!matched) {
      messages.push(
        `Kode PUM ${normalizedKode.normalized} tidak ditemukan di hierarki wilayah tersimpan — tidak dibuat wilayah baru`,
      );
      return {
        ...base,
        matchedVillageId: null,
        candidateVillageIds: [],
        status: PopulationImportRowStatus.REGION_NOT_FOUND,
        messages,
      };
    }
    const hierarchyOk =
      regionNamesMatch(f.Provinsi, matched.provinceName, 'plain') &&
      regionNamesMatch(f['Kabupaten/Kota'], matched.districtName, 'district') &&
      regionNamesMatch(f.Kecamatan, matched.subdistrictName, 'plain') &&
      regionNamesMatch(f['Desa/Kelurahan'], matched.name, 'plain');
    if (!hierarchyOk) {
      messages.push(
        `Kode cocok (${matched.code} = ${matched.name}) tetapi nama/hierarki pada baris (${f.Provinsi} / ${f['Kabupaten/Kota']} / ${f.Kecamatan} / ${f['Desa/Kelurahan']}) berbeda secara substantif — ditandai konflik, tidak diterima otomatis`,
      );
      return {
        ...base,
        matchedVillageId: matched.id,
        candidateVillageIds: [],
        status: PopulationImportRowStatus.HIERARCHY_MISMATCH,
        messages,
      };
    }
    if (hasFieldError) {
      return {
        ...base,
        matchedVillageId: matched.id,
        candidateVillageIds: [],
        status: PopulationImportRowStatus.INVALID,
        messages,
      };
    }
    return {
      ...base,
      matchedVillageId: matched.id,
      candidateVillageIds: [],
      status: PopulationImportRowStatus.VALID,
      messages,
    };
  }

  // No Kode PUM at all: fall back to full-hierarchy lookup, but NEVER
  // auto-accept — always NEEDS_REVIEW, whether 0, 1, or many candidates.
  const hierarchyKey = buildHierarchyKey(
    f.Provinsi,
    f['Kabupaten/Kota'],
    f.Kecamatan,
    f['Desa/Kelurahan'],
  );
  const candidates = lookup.byHierarchy.get(hierarchyKey) ?? [];
  messages.push(
    candidates.length === 0
      ? 'Kode PUM kosong dan tidak ada kandidat wilayah yang cocok berdasarkan hierarki nama — perlu peninjauan manual'
      : `Kode PUM kosong — ${candidates.length} kandidat wilayah ditemukan berdasarkan hierarki nama, perlu konfirmasi manual (tidak diimpor otomatis)`,
  );
  return {
    ...base,
    matchedVillageId: null,
    candidateVillageIds: candidates.map((c) => c.id),
    status: PopulationImportRowStatus.NEEDS_REVIEW,
    messages,
  };
}
