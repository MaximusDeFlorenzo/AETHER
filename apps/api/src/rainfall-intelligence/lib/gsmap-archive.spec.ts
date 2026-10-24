import {
  archiveDayDir,
  latestArchiveDay,
  parseIsoDay,
  pickArchiveFiles,
} from './gsmap-archive';

const DAY = new Date(Date.UTC(2024, 0, 1));

describe('GSMaP_Gauge archive layout', () => {
  it('builds the hourly_G day directory', () => {
    expect(archiveDayDir(DAY)).toBe('/standard/v8/hourly_G/2024/01/01');
  });

  it('picks one file per hour, the highest reprocessed version winning', () => {
    const files = pickArchiveFiles(
      [
        'gsmap_gauge.20240101.0000.v8.1000.0.dat.gz',
        'gsmap_gauge.20240101.0000.v8.1000.1.dat.gz',
        'gsmap_gauge.20240101.2300.v8.1000.0.dat.gz',
        'gsmap_gauge.20240102.0100.v8.1000.0.dat.gz', // other day
        'gsmap_mvk.20240101.0100.v8.1000.0.dat.gz', // not gauge-calibrated
        'README.txt',
      ],
      DAY,
    );
    expect(files).toHaveLength(24);
    expect(files[0]?.version).toBe('v8.1000.1');
    expect(files[23]?.name).toBe('gsmap_gauge.20240101.2300.v8.1000.0.dat.gz');
    expect(files.filter(Boolean)).toHaveLength(2);
  });

  it('expects data three days back and validates ISO days', () => {
    expect(
      latestArchiveDay(new Date('2026-10-08T05:00:00Z')).toISOString(),
    ).toBe('2026-10-05T00:00:00.000Z');
    expect(parseIsoDay('2024-02-30')).toBeNull();
    expect(parseIsoDay('2024-02-29')?.toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });
});
