import {
  normalizeKodePum,
  normalizeRegionName,
  normalizePlainRegionName,
  regionNamesMatch,
} from './code-normalization';

describe('normalizeKodePum', () => {
  it('inserts dots at the province/kabupaten/kecamatan/desa boundaries', () => {
    expect(normalizeKodePum('1109072008')).toEqual({
      normalized: '11.09.07.2008',
      error: null,
    });
  });

  it('treats an empty value as "not provided", not an error', () => {
    expect(normalizeKodePum('')).toEqual({ normalized: null, error: null });
    expect(normalizeKodePum(undefined)).toEqual({
      normalized: null,
      error: null,
    });
  });

  it('rejects a value that is not exactly 10 digits (too short)', () => {
    const result = normalizeKodePum('110907200');
    expect(result.normalized).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('rejects a value that is not exactly 10 digits (too long)', () => {
    const result = normalizeKodePum('11090720081');
    expect(result.normalized).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('rejects a non-numeric value rather than coercing it', () => {
    const result = normalizeKodePum('110907200A');
    expect(result.normalized).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeKodePum(' 1109072008 ').normalized).toBe('11.09.07.2008');
  });
});

describe('normalizeRegionName', () => {
  it('strips the "KAB." prefix', () => {
    expect(normalizeRegionName('KAB. SIMEULUE')).toBe('SIMEULUE');
  });

  it('strips the "Kabupaten" prefix regardless of case', () => {
    expect(normalizeRegionName('Kabupaten Simeulue')).toBe('SIMEULUE');
  });

  it('strips the "Kota" prefix', () => {
    expect(normalizeRegionName('Kota Sorong')).toBe('SORONG');
  });

  it('collapses punctuation and extra whitespace', () => {
    expect(normalizeRegionName('  Teupah   Selatan.. ')).toBe('TEUPAH SELATAN');
  });
});

describe('regionNamesMatch', () => {
  it('"KAB. SIMEULUE" matches "Kabupaten Simeulue" at district level (the default)', () => {
    expect(regionNamesMatch('KAB. SIMEULUE', 'Kabupaten Simeulue')).toBe(true);
  });

  it('does not match two genuinely different names', () => {
    expect(regionNamesMatch('KAB. SIMEULUE', 'Kabupaten Aceh Selatan')).toBe(
      false,
    );
  });

  it('does not match two empty/prefix-only names to each other', () => {
    expect(regionNamesMatch('Kabupaten', 'Kota')).toBe(false);
  });

  // Regression: found live in the 100k-row e2e test against real seeded
  // data — "Kecamatan Kota" (Kota Kediri) was flagged HIERARCHY_MISMATCH
  // even though the row's data was byte-for-byte identical to the
  // database, because the district-level normalizer strips the word
  // "KOTA" and was (incorrectly) also being used for the subdistrict
  // field, collapsing "Kota" to an empty string.
  it('at "plain" level, a literal "Kota" subdistrict/village name matches itself instead of being stripped to empty', () => {
    expect(regionNamesMatch('Kota', 'Kota', 'plain')).toBe(true);
    expect(normalizePlainRegionName('Kota')).toBe('KOTA');
  });

  it('at "plain" level, "Kab" is also not treated as a prefix to strip', () => {
    expect(regionNamesMatch('Kab', 'Kab', 'plain')).toBe(true);
  });
});
