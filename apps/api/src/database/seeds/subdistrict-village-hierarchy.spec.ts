import { readFileSync } from 'fs';
import { join } from 'path';
import { loadDistricts } from './reference-data.seed';

// Data-integrity checks on the kecamatan/kelurahan-desa hierarchy files —
// no database required. Provenance: parsed 2026-09-22 from
// github.com/cahyadsn/wilayah's db/wilayah.sql (Kepmendagri No 300.2.2-2138
// Tahun 2025) with a SQL-string-escape-aware parser (see
// seed-subdistricts-and-villages.ts's top comment for why a naive first
// pass under-counted by 437 rows). These tests assert shape/mapping, not
// accuracy against the source registry (verified manually once, outside
// this suite).
interface SubdistrictRecord {
  code: string;
  name: string;
  districtCode: string;
}

interface VillageRecord {
  code: string;
  name: string;
  subdistrictCode: string;
}

function loadJson<T>(filename: string): T {
  const path = join(__dirname, 'data', filename);
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

describe('subdistricts (kecamatan) dataset', () => {
  const districts = loadDistricts();
  const districtCodes = new Set(districts.map((d) => d.districtCode));
  const subdistricts = loadJson<SubdistrictRecord[]>(
    'indonesia-subdistricts.json',
  );

  it('covers all 7,285 kecamatan (Kepmendagri No 300.2.2-2138 Tahun 2025 count)', () => {
    expect(subdistricts).toHaveLength(7285);
  });

  it('has no duplicate code', () => {
    const codes = subdistricts.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code matches the kecamatan format (province.district.subdistrict)', () => {
    for (const s of subdistricts) {
      expect(s.code).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
    }
  });

  it('every code is derived from its own districtCode (never independent of it)', () => {
    for (const s of subdistricts) {
      expect(s.code.startsWith(`${s.districtCode}.`)).toBe(true);
    }
  });

  it('every districtCode maps to a real district — none left unmapped', () => {
    const unmapped = subdistricts.filter(
      (s) => !districtCodes.has(s.districtCode),
    );
    expect(unmapped).toEqual([]);
  });

  it('handles a name containing an escaped apostrophe correctly (regression: Ma’u, 12.04.28)', () => {
    const record = subdistricts.find((s) => s.code === '12.04.28');
    expect(record?.name).toBe("Ma'u");
  });
});

describe('villages (kelurahan/desa) dataset', () => {
  const subdistricts = loadJson<SubdistrictRecord[]>(
    'indonesia-subdistricts.json',
  );
  const subdistrictCodes = new Set(subdistricts.map((s) => s.code));
  const villages = loadJson<VillageRecord[]>('indonesia-villages.json');

  it('covers all 83,762 kelurahan/desa (Kepmendagri No 300.2.2-2138 Tahun 2025 count)', () => {
    expect(villages).toHaveLength(83762);
  });

  it('has no duplicate code', () => {
    const codes = villages.map((v) => v.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code matches the kelurahan/desa format (province.district.subdistrict.village)', () => {
    for (const v of villages) {
      expect(v.code).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/);
    }
  });

  it('every code is derived from its own subdistrictCode (never independent of it)', () => {
    for (const v of villages) {
      expect(v.code.startsWith(`${v.subdistrictCode}.`)).toBe(true);
    }
  });

  it('every subdistrictCode maps to a real subdistrict — none left unmapped', () => {
    const unmapped = villages.filter(
      (v) => !subdistrictCodes.has(v.subdistrictCode),
    );
    expect(unmapped).toEqual([]);
  });

  it('has no blank names', () => {
    expect(villages.every((v) => v.name.trim().length > 0)).toBe(true);
  });
});
