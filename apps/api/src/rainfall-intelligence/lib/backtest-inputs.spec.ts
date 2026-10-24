import {
  dayChunks,
  eventMatrix,
  rainSeries,
  utcOffsetForRegionCode,
} from './backtest-inputs';

describe('backtest inputs', () => {
  it('assigns WIB / WITA / WIT by province (Keppres 41/1987)', () => {
    expect(utcOffsetForRegionCode('31.71')).toBe(7); // DKI Jakarta
    expect(utcOffsetForRegionCode('12.05')).toBe(7); // Sumatera Utara
    expect(utcOffsetForRegionCode('61.71')).toBe(7); // Kalimantan Barat
    expect(utcOffsetForRegionCode('64.72')).toBe(8); // Kalimantan Timur
    expect(utcOffsetForRegionCode('51.71')).toBe(8); // Bali
    expect(utcOffsetForRegionCode('73.71')).toBe(8); // Sulawesi Selatan
    expect(utcOffsetForRegionCode('81.71')).toBe(9); // Maluku
    expect(utcOffsetForRegionCode('94.05')).toBe(9); // Papua Tengah
    expect(utcOffsetForRegionCode('99.01')).toBeNull();
  });

  it('chunks days', () => {
    expect(dayChunks(70, 31)).toEqual([
      { offset: 0, days: 31 },
      { offset: 31, days: 31 },
      { offset: 62, days: 8 },
    ]);
  });

  it('lays archive days out as hours ending at day + h + 1, NaN where missing', () => {
    const index = new Map([
      ['a', 0],
      ['b', 1],
    ]);
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 5 ? null : h));
    const { values, hours, seriesStart } = rainSeries(
      [
        { districtId: 'a', day: '2024-01-02', hourlyMm: hourly },
        { districtId: 'x', day: '2024-01-02', hourlyMm: hourly },
      ],
      index,
      new Date(Date.UTC(2024, 0, 1)),
      new Date(Date.UTC(2024, 0, 2)),
    );
    expect(hours).toBe(48);
    expect(seriesStart.toISOString()).toBe('2024-01-01T01:00:00.000Z');
    expect(Number.isNaN(values[0])).toBe(true); // a, Jan 1 not archived
    expect(values[24 + 3]).toBe(3);
    expect(Number.isNaN(values[24 + 5])).toBe(true);
    expect(Number.isNaN(values[48 + 30])).toBe(true); // b: nothing
  });

  it('marks district-days with a report', () => {
    const index = new Map([
      ['a', 0],
      ['b', 1],
    ]);
    const m = eventMatrix(
      [
        { districtId: 'b', localDate: '2024-01-03' },
        { districtId: 'b', localDate: '2024-01-03' },
        { districtId: 'a', localDate: '2023-12-31' }, // before the period
      ],
      index,
      new Date(Date.UTC(2024, 0, 1)),
      5,
    );
    expect(Array.from(m)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
  });
});
