import {
  PopulationImportRowStatus,
  PopulationNumberFormat,
  PopulationPeriodStatus,
} from '../../common/enums/domain.enum';
import {
  buildHierarchyKey,
  processRow,
  type VillageIndexEntry,
  type VillageLookup,
} from './row-processor';
import type { CsvDataRow } from './csv-parser';

const LATIUNG: VillageIndexEntry = {
  id: 'village-latiung',
  code: '11.09.07.2008',
  name: 'LATIUNG',
  subdistrictName: 'TEUPAH SELATAN',
  districtName: 'KAB. SIMEULUE',
  provinceName: 'ACEH',
};

function lookupWith(...entries: VillageIndexEntry[]): VillageLookup {
  const byCode = new Map(entries.map((e) => [e.code, e]));
  const byHierarchy = new Map<string, VillageIndexEntry[]>();
  for (const e of entries) {
    const key = buildHierarchyKey(
      e.provinceName,
      e.districtName,
      e.subdistrictName,
      e.name,
    );
    byHierarchy.set(key, [...(byHierarchy.get(key) ?? []), e]);
  }
  return { byCode, byHierarchy };
}

const CONFIRMED_2014_SETTINGS = {
  numberFormat: PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR,
  periodStatus: PopulationPeriodStatus.CONFIRMED,
  periodYear: 2014,
  sourceName: 'Test Source',
};

function rowFromFields(
  fields: Record<string, string>,
  rowNumber = 1,
): CsvDataRow {
  return {
    rowNumber,
    rawLine: Object.values(fields).join(';'),
    columnCount: 12,
    fields: fields as CsvDataRow['fields'],
  };
}

const EXAMPLE_FIELDS = {
  Provinsi: 'ACEH',
  'Kabupaten/Kota': 'KAB. SIMEULUE',
  Kecamatan: 'TEUPAH SELATAN',
  Status: 'DESA',
  'Kode PUM': '1109072008',
  'Desa/Kelurahan': 'LATIUNG',
  Tanggal: '17/06/2014',
  'Laki-Laki': '220',
  Perempuan: '300',
  'Jumlah Penduduk': '520',
  'Jumlah KK': '40',
  'Kepadatan (Jiwa/Km2)': '26.000',
};

describe('processRow — the spec example row', () => {
  it('matches by Kode PUM, cross-checks hierarchy, and produces a VALID row with correctly typed fields', () => {
    const result = processRow(
      rowFromFields(EXAMPLE_FIELDS),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );

    expect(result.status).toBe(PopulationImportRowStatus.VALID);
    expect(result.matchedVillageId).toBe('village-latiung');
    expect(result.normalizedCode).toBe('11.09.07.2008');
    expect(result.male).toBe(220);
    expect(result.female).toBe(300);
    expect(result.totalPopulation).toBe(520);
    expect(result.households).toBe(40);
    expect(result.densityRaw).toBe('26.000');
    expect(result.densityConverted).toBe(26000);
    expect(result.parsedDate).toBe('2014-06-17');
    expect(result.dedupeKey).toBe('year:2014');
  });

  it('flags Laki-Laki + Perempuan != Jumlah Penduduk instead of silently correcting it', () => {
    const bad = { ...EXAMPLE_FIELDS, 'Jumlah Penduduk': '525' };
    const result = processRow(
      rowFromFields(bad),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );

    expect(result.status).toBe(PopulationImportRowStatus.INVALID);
    expect(result.male).toBe(220); // values still parsed and surfaced, not discarded
    expect(result.totalPopulation).toBe(525);
    expect(result.messages.some((m) => m.includes('tidak sama dengan'))).toBe(
      true,
    );
  });
});

describe('processRow — region matching', () => {
  it('REGION_NOT_FOUND for a well-formed Kode PUM that matches no village (never creates one)', () => {
    const fields = { ...EXAMPLE_FIELDS, 'Kode PUM': '9999999999' };
    const result = processRow(
      rowFromFields(fields),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.REGION_NOT_FOUND);
    expect(result.matchedVillageId).toBeNull();
  });

  it('HIERARCHY_MISMATCH when the code matches but the row’s named hierarchy substantially differs', () => {
    const fields = { ...EXAMPLE_FIELDS, Kecamatan: 'KECAMATAN LAIN SEKALI' };
    const result = processRow(
      rowFromFields(fields),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.HIERARCHY_MISMATCH);
    expect(result.matchedVillageId).toBe('village-latiung'); // matched, but flagged
  });

  it('tolerates "KAB." vs "Kabupaten" writing differences in the hierarchy cross-check', () => {
    const fields = {
      ...EXAMPLE_FIELDS,
      'Kabupaten/Kota': 'Kabupaten Simeulue',
    };
    const result = processRow(
      rowFromFields(fields),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.VALID);
  });

  it('NEEDS_REVIEW (never auto-imported) when Kode PUM is empty, even with exactly one hierarchy candidate', () => {
    const fields = { ...EXAMPLE_FIELDS, 'Kode PUM': '' };
    const result = processRow(
      rowFromFields(fields),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.NEEDS_REVIEW);
    expect(result.matchedVillageId).toBeNull();
    expect(result.candidateVillageIds).toEqual(['village-latiung']);
  });

  it('NEEDS_REVIEW with an empty candidate list when Kode PUM is empty and nothing matches by hierarchy', () => {
    const fields = {
      ...EXAMPLE_FIELDS,
      'Kode PUM': '',
      'Desa/Kelurahan': 'DESA TIDAK DIKENAL',
    };
    const result = processRow(
      rowFromFields(fields),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.NEEDS_REVIEW);
    expect(result.candidateVillageIds).toEqual([]);
  });

  it('INVALID for a structurally wrong Kode PUM (not 10 digits) rather than falling back to hierarchy', () => {
    const fields = { ...EXAMPLE_FIELDS, 'Kode PUM': '12345' };
    const result = processRow(
      rowFromFields(fields),
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.INVALID);
  });

  // Regression: found live in the 100k-row e2e test against real seeded
  // data (Kecamatan Kota, Kota Kediri) — a subdistrict literally named
  // "Kota" was always flagged HIERARCHY_MISMATCH, even for a row whose
  // hierarchy fields exactly matched the database, because the
  // district-only KAB/KABUPATEN/KOTA prefix-stripping normalizer was also
  // being applied to the subdistrict/village fields (see
  // code-normalization.ts's `normalizePlainRegionName`).
  it('VALID for a subdistrict literally named "Kota" — that word is not an administrative prefix to strip at this level', () => {
    const kediriKota: VillageIndexEntry = {
      id: 'village-semampir',
      code: '35.71.02.1001',
      name: 'Semampir',
      subdistrictName: 'Kota',
      districtName: 'Kota Kediri',
      provinceName: 'Jawa Timur',
    };
    const fields = {
      ...EXAMPLE_FIELDS,
      Provinsi: 'Jawa Timur',
      'Kabupaten/Kota': 'Kota Kediri',
      Kecamatan: 'Kota',
      'Kode PUM': '3571021001',
      'Desa/Kelurahan': 'Semampir',
    };
    const result = processRow(
      rowFromFields(fields),
      lookupWith(kediriKota),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.VALID);
    expect(result.matchedVillageId).toBe('village-semampir');
  });
});

describe('processRow — malformed structural row', () => {
  it('INVALID with no crash when fields is undefined (wrong column count upstream)', () => {
    const row: CsvDataRow = {
      rowNumber: 5,
      rawLine: 'a;b;c',
      columnCount: 3,
      fields: undefined,
    };
    const result = processRow(
      row,
      lookupWith(LATIUNG),
      CONFIRMED_2014_SETTINGS,
    );
    expect(result.status).toBe(PopulationImportRowStatus.INVALID);
    expect(result.rowNumber).toBe(5);
  });
});

describe('processRow — dedupe key by period status', () => {
  it('uses "year:<N>" for a confirmed period', () => {
    const result = processRow(
      rowFromFields(EXAMPLE_FIELDS),
      lookupWith(LATIUNG),
      {
        ...CONFIRMED_2014_SETTINGS,
        periodYear: 2020,
      },
    );
    expect(result.dedupeKey).toBe('year:2020');
  });

  it('uses "unknown:<reportedDate>:<source>" for an unknown period, keyed by the row’s own reported date', () => {
    const result = processRow(
      rowFromFields(EXAMPLE_FIELDS),
      lookupWith(LATIUNG),
      {
        numberFormat: PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR,
        periodStatus: PopulationPeriodStatus.UNKNOWN,
        periodYear: null,
        sourceName: 'Prodeskel',
      },
    );
    expect(result.dedupeKey).toBe('unknown:2014-06-17:Prodeskel');
  });

  it('two unknown-period rows for the same village on DIFFERENT report dates get different dedupe keys (not conflated)', () => {
    const settings = {
      numberFormat: PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR,
      periodStatus: PopulationPeriodStatus.UNKNOWN,
      periodYear: null,
      sourceName: 'Prodeskel',
    };
    const r1 = processRow(
      rowFromFields(EXAMPLE_FIELDS),
      lookupWith(LATIUNG),
      settings,
    );
    const r2 = processRow(
      rowFromFields({ ...EXAMPLE_FIELDS, Tanggal: '18/06/2014' }),
      lookupWith(LATIUNG),
      settings,
    );
    expect(r1.dedupeKey).not.toBe(r2.dedupeKey);
  });
});
