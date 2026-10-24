import { Readable } from 'node:stream';
import {
  CsvStructureError,
  parseCsvStream,
  type CsvDataRow,
} from './csv-parser';

const EXAMPLE_ROW =
  'ACEH;"KAB. SIMEULUE";"TEUPAH SELATAN";"DESA";"1109072008";"LATIUNG";"17/06/2014";"220";"300";"520";"40";"26.000"';

const HEADER =
  'Provinsi;Kabupaten/Kota;Kecamatan;Status;Kode PUM;Desa/Kelurahan;Tanggal;Laki-Laki;Perempuan;Jumlah Penduduk;Jumlah KK;Kepadatan (Jiwa/Km2)';

async function collect(gen: AsyncGenerator<CsvDataRow>): Promise<CsvDataRow[]> {
  const out: CsvDataRow[] = [];
  for await (const row of gen) out.push(row);
  return out;
}

// The streaming path is what the validation worker actually calls on a
// real upload (parseCsv/`csv-parse/sync` is buffer-everything, kept only
// for the small fixtures the rest of this module's tests use) — these
// tests exist specifically to prove the two paths agree, not to re-derive
// every rule csv-parser.spec.ts already covers structurally.
describe('parseCsvStream — no header', () => {
  it('yields the first row as data, never drops it as a header', async () => {
    const rows = await collect(parseCsvStream(Buffer.from(EXAMPLE_ROW), false));
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(1);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
  });

  it('produces the exact same fields as the sync parser for the same input', async () => {
    const rows = await collect(parseCsvStream(Buffer.from(EXAMPLE_ROW), false));
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

  it('numbers rows sequentially across many records without buffering them all first', async () => {
    const many = Array.from({ length: 500 }, () => EXAMPLE_ROW).join('\n');
    const rows = await collect(parseCsvStream(Buffer.from(many), false));
    expect(rows).toHaveLength(500);
    expect(rows[0].rowNumber).toBe(1);
    expect(rows[499].rowNumber).toBe(500);
  });

  it('flags a row with the wrong column count instead of misaligning it', async () => {
    const rows = await collect(
      parseCsvStream(Buffer.from('ACEH;"KAB. SIMEULUE";"only three"'), false),
    );
    expect(rows[0].columnCount).toBe(3);
    expect(rows[0].fields).toBeUndefined();
  });
});

describe('parseCsvStream — with header', () => {
  it('does not yield the header row as data', async () => {
    const buf = Buffer.from(`${HEADER}\n${EXAMPLE_ROW}\n`);
    const rows = await collect(parseCsvStream(buf, true));
    expect(rows).toHaveLength(1);
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
  });

  it('allows a different column order, same as the sync parser', async () => {
    const reordered =
      'Kode PUM;Provinsi;Desa/Kelurahan;Kabupaten/Kota;Kecamatan;Status;Tanggal;Laki-Laki;Perempuan;Jumlah Penduduk;Jumlah KK;Kepadatan (Jiwa/Km2)';
    const dataRow =
      '"1109072008";ACEH;LATIUNG;"KAB. SIMEULUE";"TEUPAH SELATAN";DESA;17/06/2014;220;300;520;40;26.000';
    const buf = Buffer.from(`${reordered}\n${dataRow}\n`);
    const rows = await collect(parseCsvStream(buf, true));
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
    expect(rows[0].fields?.['Kode PUM']).toBe('1109072008');
  });

  it('throws CsvStructureError on the first iteration when a required column is missing', async () => {
    const incomplete = HEADER.replace('Kode PUM;', '');
    const buf = Buffer.from(`${incomplete}\n`);
    await expect(collect(parseCsvStream(buf, true))).rejects.toThrow(
      CsvStructureError,
    );
  });
});

describe('parseCsvStream — accepts a real stream, not just a Buffer', () => {
  it('parses correctly when given a Node Readable instead of a Buffer', async () => {
    const stream = Readable.from(Buffer.from(EXAMPLE_ROW));
    const rows = await collect(parseCsvStream(stream, false));
    expect(rows[0].fields?.Provinsi).toBe('ACEH');
  });
});
