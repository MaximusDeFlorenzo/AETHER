import {
  GSMAP_GRID_BYTES,
  GSMAP_NX,
  gsmapCell,
  gsmapFileName,
  parseGsmapFileName,
  sampleGsmap,
} from './gsmap';

/** Blank grid with selected cells set. */
function grid(cells: Array<{ column: number; line: number; value: number }>) {
  const buffer = Buffer.alloc(GSMAP_GRID_BYTES);
  for (const { column, line, value } of cells) {
    buffer.writeFloatLE(value, (line * GSMAP_NX + column) * 4);
  }
  return buffer;
}

describe('gsmapCell', () => {
  it('matches the documented corners', () => {
    // First cell centre (0.05°E, 59.95°N), last (0.05°W, 59.95°S).
    expect(gsmapCell(59.95, 0.05)).toEqual({ column: 0, line: 0 });
    expect(gsmapCell(-59.95, -0.05)).toEqual({ column: 3599, line: 1199 });
  });

  it('locates Jakarta and wraps western longitudes', () => {
    expect(gsmapCell(-6.2, 106.8)).toEqual({ column: 1068, line: 662 });
    expect(gsmapCell(10, -170)).toEqual(gsmapCell(10, 190));
  });

  it('is null outside 60°S–60°N', () => {
    expect(gsmapCell(60.05, 10)).toBeNull();
    expect(gsmapCell(-60.05, 10)).toBeNull();
    expect(gsmapCell(NaN, 10)).toBeNull();
  });
});

describe('sampleGsmap', () => {
  const jakarta = gsmapCell(-6.2, 106.8)!;

  it('returns the hourly rain (mm) at the point', () => {
    const value = sampleGsmap(
      grid([{ ...jakarta, value: 12.345 }]),
      -6.2,
      106.8,
    );
    expect(value).toEqual({ precipitationMm: 12.35, qualityFlags: [] });
  });

  it('maps the documented negative missing codes to NULL + flag', () => {
    for (const [code, flag] of [
      [-4, 'gsmap:missing_sea_ice'],
      [-8, 'gsmap:missing_low_temperature'],
      [-99, 'gsmap:no_observation'],
      [-1, 'gsmap:invalid'],
    ] as const) {
      expect(
        sampleGsmap(grid([{ ...jakarta, value: code }]), -6.2, 106.8),
      ).toEqual({ precipitationMm: null, qualityFlags: [flag] });
    }
  });

  it('rejects physically impossible rates', () => {
    expect(
      sampleGsmap(grid([{ ...jakarta, value: 999 }]), -6.2, 106.8),
    ).toEqual({
      precipitationMm: null,
      qualityFlags: ['precipitation:out_of_range'],
    });
  });

  it('refuses a truncated grid instead of reading garbage', () => {
    expect(() => sampleGsmap(Buffer.alloc(100), -6.2, 106.8)).toThrow(
      /expected 17280000/,
    );
  });
});

describe('GSMaP file names', () => {
  it('parses hour-aligned names; valid time is the window end', () => {
    expect(parseGsmapFileName('gsmap_gauge_now.20261006.1200.dat.gz')).toEqual({
      product: 'gsmap_gauge_now',
      start: new Date('2026-10-06T12:00:00Z'),
      validTime: new Date('2026-10-06T13:00:00Z'),
      name: 'gsmap_gauge_now.20261006.1200.dat.gz',
    });
  });

  it('skips :30 windows, long-form names and other products', () => {
    expect(parseGsmapFileName('gsmap_now.20261006.1230.dat.gz')).toBeNull();
    expect(
      parseGsmapFileName('gsmap_now.20261006.1200_1259.dat.gz'),
    ).toBeNull();
    expect(parseGsmapFileName('gsmap_now_rain.20261006.1200.nc')).toBeNull();
    expect(parseGsmapFileName('gsmap_now.20261306.1200.dat.gz')).toBeNull();
  });

  it('builds names that round-trip', () => {
    const name = gsmapFileName('gsmap_now', new Date('2026-01-02T03:00:00Z'));
    expect(name).toBe('gsmap_now.20260102.0300.dat.gz');
    expect(parseGsmapFileName(name)?.start.toISOString()).toBe(
      '2026-01-02T03:00:00.000Z',
    );
  });
});
