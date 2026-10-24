import { loadDistricts } from './reference-data.seed';

// Data-integrity checks on `data/indonesia-districts.json` itself, run
// through the seed's own `loadDistricts()` — no database required. These
// catch regressions in the imported dataset (missing/duplicate regions,
// malformed codes, non-numeric population/area) independently of whether
// the seed's insert logic is exercised against a real Postgres instance.
//
// Provenance (verified 2026-09-22 by diffing all 514 rows against
// github.com/cahyadsn/wilayah's db/wilayah_penduduk.sql and
// db/wilayah_luas.sql — see reference-data.seed.ts's top comment): this is
// real Kemendagri/Dukcapil (population, Semester II Des 2024) and BIG (area)
// data, not illustrative — these tests assert its shape/completeness, not
// its accuracy against the source registry (that was verified manually,
// once, outside this test suite; re-diff if the JSON file is ever
// regenerated).
describe('reference-data.seed districts dataset', () => {
  const districts = loadDistricts();

  it('covers all 514 of Indonesia’s kabupaten/kota (Kepmendagri No 300.2.2-2138 Tahun 2025 count)', () => {
    expect(districts).toHaveLength(514);
  });

  it('covers all 38 provinces', () => {
    const provinceCodes = new Set(districts.map((d) => d.provinceCode));
    expect(provinceCodes.size).toBe(38);
  });

  it('has no duplicate districtCode (would silently collide on the districts.bps_code unique constraint)', () => {
    const codes = districts.map((d) => d.districtCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every districtCode matches the 2-digit-province.2-digit-regency BPS/Kemendagri format', () => {
    for (const d of districts) {
      expect(d.districtCode).toMatch(/^\d{2}\.\d{2}$/);
    }
  });

  it('every record has a positive population and area (no silent zero-fill for missing source data)', () => {
    for (const d of districts) {
      expect(d.population).toBeGreaterThan(0);
      expect(Number.isFinite(d.population)).toBe(true);
      expect(d.areaKm2).toBeGreaterThan(0);
      expect(Number.isFinite(d.areaKm2)).toBe(true);
    }
  });

  it('every record has real (non-zero) coordinates', () => {
    for (const d of districts) {
      expect(d.latitude === 0 && d.longitude === 0).toBe(false);
    }
  });

  it('matches a known reference row exactly (spot-check against upstream wilayah_penduduk.sql / wilayah_luas.sql)', () => {
    const acehSelatan = districts.find((d) => d.districtCode === '11.01');
    expect(acehSelatan).toMatchObject({
      districtName: 'Kabupaten Aceh Selatan',
      provinceCode: '11',
      population: 239629,
      areaKm2: 4174.211,
    });
  });

  it('reproduces the seed’s own population_density formula (population / areaKm2, people per km²)', () => {
    const acehSelatan = districts.find((d) => d.districtCode === '11.01')!;
    const density = acehSelatan.population / acehSelatan.areaKm2;
    expect(Math.round(density * 100) / 100).toBeCloseTo(57.41, 2);
  });
});
