import {
  matchByName,
  normalizeAreaName,
  pickDistrict,
} from './public-locate.service';

describe('normalizeAreaName', () => {
  it('strips administrative prefixes so OSM and Kemendagri names compare equal', () => {
    expect(normalizeAreaName('Kota Administrasi Jakarta Selatan')).toBe(
      'jakarta selatan',
    );
    expect(normalizeAreaName('Kabupaten Sukabumi')).toBe('sukabumi');
    expect(normalizeAreaName('Kec. Cibadak')).toBe('cibadak');
  });
});

describe('pickDistrict', () => {
  const kab = { name: 'Kabupaten Sukabumi' };
  const kota = { name: 'Kota Sukabumi' };

  it('uses OSM `county` to choose the kabupaten over a same-named kota', () => {
    // Kota listed first = nearer, yet the county tag still wins.
    expect(
      pickDistrict([kota, kab], { county: 'Sukabumi', town: 'Cibadak' }),
    ).toBe(kab);
  });

  it('uses OSM `city` / `city_district` to choose the kota', () => {
    expect(pickDistrict([kab, kota], { city: 'Sukabumi' })).toBe(kota);
    expect(
      pickDistrict(
        [
          { name: 'Kota Administrasi Jakarta Selatan' },
          { name: 'Kota Administrasi Jakarta Pusat' },
        ],
        {
          city_district: 'Jakarta Selatan',
          city: 'Daerah Khusus Ibukota Jakarta',
        },
      )?.name,
    ).toBe('Kota Administrasi Jakarta Selatan');
  });

  it('returns null when no candidate name appears in the address (caller falls back to nearest)', () => {
    expect(pickDistrict([kab, kota], { county: 'Cianjur' })).toBeNull();
  });
});

describe('matchByName', () => {
  it('matches only under the given keys', () => {
    const villages = [{ name: 'Cibadak' }, { name: 'Sekarwangi' }];
    // `town` is the kecamatan's main town, not proof the point is in desa Cibadak.
    expect(
      matchByName(villages, { town: 'Cibadak' }, ['village', 'hamlet']),
    ).toBeNull();
    expect(
      matchByName(villages, { village: 'Sekarwangi' }, ['village', 'hamlet'])
        ?.name,
    ).toBe('Sekarwangi');
  });

  it('refuses an ambiguous match rather than guessing', () => {
    const villages = [{ name: 'Sukamaju' }, { name: 'Sukamaju' }];
    expect(
      matchByName(villages, { village: 'Sukamaju' }, ['village']),
    ).toBeNull();
  });
});
