import { countryAt } from './country-lookup';

describe('countryAt', () => {
  it.each([
    [-2.47, 114.4, 'IDN'], // Kalimantan Tengah peat
    [-0.5, 101.5, 'IDN'], // Riau
    [-4.0, 138.5, 'IDN'], // Papua highlands
    [2.5, 113.0, 'MYS'], // Sarawak
    [4.9, 114.9, 'BRN'],
    [-6.0, 143.0 - 0.5, 'PNG'],
    [-8.8, 125.9, 'TLS'],
    [-11.9, 133.66, 'AUS'], // Arnhem Land, inside the FIRMS bbox
  ])('(%d, %d) is in %s', (lat, lng, iso) => {
    expect(countryAt(lat, lng)?.iso).toBe(iso);
  });

  it('snaps a point just off a coarse coastline to that country', () => {
    // ~5 km south of the 1:50m Kalimantan coast vertex (113.7958, -3.45625).
    expect(countryAt(-3.5, 113.7958)?.iso).toBe('IDN');
  });

  it('returns null in open sea', () => {
    expect(countryAt(-5.0, 96.0)).toBeNull();
  });
});
