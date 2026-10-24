export interface NormalizedKodePum {
  normalized: string | null; // "11.09.07.2008"
  error: string | null;
}

const TEN_DIGITS = /^\d{10}$/;

/**
 * "1109072008" -> "11.09.07.2008" — a structural transformation only,
 * applied after confirming the raw value is exactly 10 digits (the same
 * province[2]+kabupaten[2]+kecamatan[2]+desa[4] grouping `villages.code`
 * already uses — Kemendagri's "PUM" numbering, verified same-scheme by
 * example against the seeded `villages.code` values, not assumed). Never
 * applied to a value that isn't exactly 10 digits — a wrong-length or
 * non-numeric Kode PUM is reported as invalid, not coerced.
 */
export function normalizeKodePum(raw: string | undefined): NormalizedKodePum {
  if (raw === undefined || raw.trim() === '') {
    return { normalized: null, error: null };
  }
  const trimmed = raw.trim();
  if (!TEN_DIGITS.test(trimmed)) {
    return {
      normalized: null,
      error: `Kode PUM harus 10 digit angka, ditemukan "${raw}" (${trimmed.length} karakter)`,
    };
  }
  const normalized = `${trimmed.slice(0, 2)}.${trimmed.slice(2, 4)}.${trimmed.slice(4, 6)}.${trimmed.slice(6, 10)}`;
  return { normalized, error: null };
}

function normalizePunctuationAndCase(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalizes a KABUPATEN/KOTA (district-level) name for a HIERARCHY
 * CROSS-CHECK only (after a Village has already been matched by code) —
 * strips known administrative-level prefixes ("KAB.", "KABUPATEN", "KOTA")
 * and punctuation/whitespace noise so "KAB. SIMEULUE" and "Kabupaten
 * Simeulue" compare equal. This is deliberately NOT a fuzzy-matching
 * mechanism for finding an unmatched region — it only ever compares two
 * names for a region the code already identified, to flag a substantive
 * mismatch.
 *
 * District-level ONLY — see `normalizePlainRegionName` for why.
 */
export function normalizeRegionName(raw: string): string {
  return normalizePunctuationAndCase(
    raw
      .toUpperCase()
      .replace(/\bKAB\.?\b/g, '')
      .replace(/\bKABUPATEN\b/g, '')
      .replace(/\bKOTA\b/g, ''),
  );
}

/**
 * Plain name normalization (case/punctuation/whitespace only, no
 * administrative-prefix stripping) for province/subdistrict/village
 * comparisons. Verified live against the seeded region hierarchy
 * (village-population-import 100k-row e2e test) that reusing
 * `normalizeRegionName`'s KAB/KABUPATEN/KOTA-stripping at these levels is
 * wrong: real kecamatan are sometimes literally named "Kota" (e.g.
 * Kecamatan Kota in Kota Kediri) or contain "Kota"/"Kab" as a real word in
 * a kelurahan/desa name — stripping that word collapses the name to an
 * empty string, which `regionNamesMatch` then always treats as a
 * non-match (`na.length > 0`), incorrectly flagging an exactly-correct row
 * as HIERARCHY_MISMATCH. Only the KABUPATEN/KOTA field itself should ever
 * have that prefix stripped.
 */
export function normalizePlainRegionName(raw: string): string {
  return normalizePunctuationAndCase(raw);
}

export function regionNamesMatch(
  a: string,
  b: string,
  level: 'district' | 'plain' = 'district',
): boolean {
  const normalize =
    level === 'district' ? normalizeRegionName : normalizePlainRegionName;
  const na = normalize(a);
  const nb = normalize(b);
  return na.length > 0 && na === nb;
}
