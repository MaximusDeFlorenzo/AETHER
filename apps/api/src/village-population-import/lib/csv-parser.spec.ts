import { CsvStructureError, parseCsv } from './csv-parser';

const EXAMPLE_ROW =
  'ACEH;"KAB. SIMEULUE";"TEUPAH SELATAN";"DESA";"1109072008";"LATIUNG";"17/06/2014";"220";"300";"520";"40";"26.000"';

const HEADER =
  'Provinsi;Kabupaten/Kota;Kecamatan;Status;Kode PUM;Desa/Kelurahan;Tanggal;Laki-Laki;Perempuan;Jumlah Penduduk;Jumlah KK;Kepadatan (Jiwa/Km2)';

describe('parseCsv — no header', () => {
  it('treats the first row as data, never as a discarded header (does not drop the "ACEH" row)', () => {
    const { rows } = parseCsv(Buffer.from(EXAMPLE_ROW), false);
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(1);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
  });

  it('maps all 12 columns positionally and produces the exact spec JSON shape', () => {
    const { rows } = parseCsv(Buffer.from(EXAMPLE_ROW), false);
    expect(rows[0].fields).toEqual({
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
    });
  });

  it('flags a row with the wrong column count instead of misaligning it', () => {
    const { rows } = parseCsv(
      Buffer.from('ACEH;"KAB. SIMEULUE";"only three"'),
      false,
    );
    expect(rows[0].columnCount).toBe(3);
    expect(rows[0].fields).toBeUndefined();
  });

  it('skips blank lines without turning them into rows', () => {
    const buf = Buffer.from(`${EXAMPLE_ROW}\n\n${EXAMPLE_ROW}\n`);
    const { rows } = parseCsv(buf, false);
    expect(rows).toHaveLength(2);
  });

  it('handles CRLF line endings the same as LF', () => {
    const buf = Buffer.from(`${EXAMPLE_ROW}\r\n${EXAMPLE_ROW}\r\n`);
    const { rows } = parseCsv(buf, false);
    expect(rows).toHaveLength(2);
    expect(rows[1].fields?.Provinsi).toBe('ACEH');
  });

  it('unescapes a doubled quote inside a quoted field via the parser, not string replacement', () => {
    const row = EXAMPLE_ROW.replace('"LATIUNG"', '"LATIUNG ""DESA"" LAMA"');
    const { rows } = parseCsv(Buffer.from(row), false);
    expect(rows[0].fields?.['Desa/Kelurahan']).toBe('LATIUNG "DESA" LAMA');
  });

  it('strips a UTF-8 BOM at the start of the file', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const buf = Buffer.concat([bom, Buffer.from(EXAMPLE_ROW)]);
    const { rows } = parseCsv(buf, false);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
  });

  it('handles a delimiter character embedded inside a quoted value', () => {
    const row = EXAMPLE_ROW.replace('"LATIUNG"', '"LATIUNG; DESA BARU"');
    const { rows } = parseCsv(Buffer.from(row), false);
    expect(rows[0].fields?.['Desa/Kelurahan']).toBe('LATIUNG; DESA BARU');
    expect(rows[0].columnCount).toBe(12);
  });
});

describe('parseCsv — with header', () => {
  it('parses the header row as header, not data (one fewer row than no-header mode)', () => {
    const buf = Buffer.from(`${HEADER}\n${EXAMPLE_ROW}\n`);
    const { rows } = parseCsv(buf, true);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
  });

  it('allows a different column order', () => {
    const reordered =
      'Kode PUM;Provinsi;Desa/Kelurahan;Kabupaten/Kota;Kecamatan;Status;Tanggal;Laki-Laki;Perempuan;Jumlah Penduduk;Jumlah KK;Kepadatan (Jiwa/Km2)';
    const dataRow =
      '"1109072008";ACEH;LATIUNG;"KAB. SIMEULUE";"TEUPAH SELATAN";DESA;17/06/2014;220;300;520;40;26.000';
    const buf = Buffer.from(`${reordered}\n${dataRow}\n`);
    const { rows } = parseCsv(buf, true);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
    expect(rows[0].fields?.['Kode PUM']).toBe('1109072008');
    expect(rows[0].fields?.['Desa/Kelurahan']).toBe('LATIUNG');
  });

  it('ignores an extra unrecognized column rather than failing', () => {
    const withExtra = `${HEADER};Catatan`;
    const dataRow = `${EXAMPLE_ROW};"catatan bebas"`;
    const buf = Buffer.from(`${withExtra}\n${dataRow}\n`);
    const { rows } = parseCsv(buf, true);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
    expect(rows[0].fields?.['Kepadatan (Jiwa/Km2)']).toBe('26.000');
  });

  it('is case- and whitespace-insensitive when matching header names', () => {
    const messyHeader =
      '  provinsi ;KABUPATEN/KOTA;kecamatan;status;kode pum;desa/kelurahan;tanggal;laki-laki;perempuan;jumlah penduduk;jumlah kk;kepadatan (jiwa/km2)';
    const buf = Buffer.from(`${messyHeader}\n${EXAMPLE_ROW}\n`);
    const { rows } = parseCsv(buf, true);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
  });

  it('throws CsvStructureError when a required column is missing from the header', () => {
    const incomplete = HEADER.replace('Kode PUM;', '');
    const buf = Buffer.from(`${incomplete}\n`);
    expect(() => parseCsv(buf, true)).toThrow(CsvStructureError);
  });

  it('throws CsvStructureError when a column name appears twice in the header', () => {
    const dup = `${HEADER};Provinsi`;
    const buf = Buffer.from(`${dup}\n`);
    expect(() => parseCsv(buf, true)).toThrow(CsvStructureError);
  });
});

describe('parseCsv — general', () => {
  it('returns no rows for a completely empty file', () => {
    expect(parseCsv(Buffer.from(''), false).rows).toEqual([]);
  });

  it('does not use naive split(";") semantics — a quoted field containing ";" stays one field regardless of hasHeaderRow', () => {
    const buf = Buffer.from(
      EXAMPLE_ROW.replace('"KAB. SIMEULUE"', '"KAB.;SIMEULUE"'),
    );
    const { rows } = parseCsv(buf, false);
    expect(rows[0].fields?.['Kabupaten/Kota']).toBe('KAB.;SIMEULUE');
    expect(rows[0].columnCount).toBe(12);
  });
});
