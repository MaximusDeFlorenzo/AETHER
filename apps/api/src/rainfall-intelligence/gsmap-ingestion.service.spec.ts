import { GsmapIngestionService } from './gsmap-ingestion.service';
import {
  GSMAP_GRID_BYTES,
  GSMAP_NX,
  gsmapCell,
  INDONESIA_RAIN_DOMAIN,
} from './lib/gsmap';
import { decodeRainGrid } from './lib/rain-grid-codec';
import { domainCell } from './lib/verification';
import { WeatherDataKind } from './rainfall.enums';

const NOW = new Date('2026-10-06T14:05:00Z');
const DISTRICTS = [
  { id: 'jakarta', latitude: '-6.2', longitude: '106.8' },
  { id: 'pidie', latitude: '5.3', longitude: '96.0' },
];

/** Grid with Jakarta's cell set to `jakartaMm` and Pidie's to -99. */
function grid(jakartaMm: number): Buffer {
  const buffer = Buffer.alloc(GSMAP_GRID_BYTES);
  const set = (lat: number, lon: number, value: number) => {
    const cell = gsmapCell(lat, lon)!;
    buffer.writeFloatLE(value, (cell.line * GSMAP_NX + cell.column) * 4);
  };
  set(-6.2, 106.8, jakartaMm);
  set(5.3, 96.0, -99);
  return buffer;
}

function build({
  configured = true,
  files = [
    'gsmap_now.20261006.1200.dat.gz',
    'gsmap_now.20261006.1200_1259.dat.gz',
    'gsmap_now.20261006.1230.dat.gz',
    'gsmap_now.20261006.1300.dat.gz',
    'gsmap_gauge_now.20261006.1300.dat.gz',
    'gsmap_now_rain.20261006.1300.nc',
  ],
  stored = [] as Array<{ source: string; valid_time: Date; n: string }>,
  storedGrids = [] as Array<{ valid_time: Date }>,
  download = jest.fn(async (name: string) =>
    grid(name.startsWith('gsmap_gauge') ? 4.5 : 3),
  ),
} = {}) {
  const inserted: Array<Array<Record<string, unknown>>> = [];
  const insertQb: Record<string, jest.Mock> = {};
  for (const m of ['insert', 'into', 'orUpdate']) {
    insertQb[m] = jest.fn(() => insertQb);
  }
  insertQb.values = jest.fn((rows: Array<Record<string, unknown>>) => {
    inserted.push(rows);
    return insertQb;
  });
  insertQb.execute = jest.fn().mockResolvedValue({});

  const gridInserts: Array<Record<string, unknown>> = [];
  const gridQb: Record<string, jest.Mock> = {};
  for (const m of ['insert', 'into', 'orUpdate']) {
    gridQb[m] = jest.fn(() => gridQb);
  }
  gridQb.values = jest.fn((row: Record<string, unknown>) => {
    gridInserts.push(row);
    return gridQb;
  });
  gridQb.execute = jest.fn().mockResolvedValue({});

  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue(DISTRICTS);

  const ftp = {
    isConfigured: jest.fn().mockReturnValue(configured),
    withSession: jest.fn(async (work: (s: unknown) => Promise<unknown>) =>
      work({ listLatest: async () => files, downloadLatest: download }),
    ),
  };
  const sync = { recordSuccess: jest.fn(), recordFailure: jest.fn() };
  const service = new GsmapIngestionService(
    ftp as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    {
      createQueryBuilder: jest.fn(() => insertQb),
      query: jest.fn().mockResolvedValue(stored),
    } as never,
    {
      createQueryBuilder: jest.fn(() => gridQb),
      query: jest.fn().mockResolvedValue(storedGrids),
    } as never,
    sync as never,
  );
  return { service, ftp, sync, download, inserted, gridInserts };
}

describe('GsmapIngestionService', () => {
  it('ingests only hour-aligned GSMaP files, sampling each district point', async () => {
    const { service, download, inserted, sync, gridInserts } = build();

    const summary = await service.ingest(NOW);

    // :30 window, long-form duplicate and NetCDF files are ignored.
    expect(download.mock.calls.map(([name]) => name)).toEqual([
      'gsmap_now.20261006.1200.dat.gz',
      'gsmap_now.20261006.1300.dat.gz',
      'gsmap_gauge_now.20261006.1300.dat.gz',
    ]);
    expect(summary).toEqual(
      expect.objectContaining({
        status: 'completed',
        filesAvailable: 3,
        filesIngested: 3,
        samplesWritten: 6,
        missingValues: 3,
        latestValidTime: '2026-10-06T14:00:00.000Z',
      }),
    );
    const gaugeRows = inserted[2];
    expect(gaugeRows[0]).toEqual(
      expect.objectContaining({
        district: { id: 'jakarta' },
        source: 'gsmap_gauge_now',
        dataKind: WeatherDataKind.SATELLITE_ESTIMATE,
        validTime: new Date('2026-10-06T14:00:00Z'),
        precipitationMm: 4.5,
        qualityFlags: [],
      }),
    );
    // GSMaP's -99 "no observation" is stored as NULL with its reason.
    expect(gaugeRows[1]).toEqual(
      expect.objectContaining({
        district: { id: 'pidie' },
        precipitationMm: null,
        qualityFlags: ['gsmap:no_observation'],
      }),
    );
    expect(sync.recordSuccess).toHaveBeenCalledWith('rainfall_gsmap_now');

    // Only the gauge product's Indonesia field is kept as a grid.
    expect(summary?.gridsWritten).toBe(1);
    expect(gridInserts).toHaveLength(1);
    const stored = gridInserts[0];
    expect(stored).toEqual(
      expect.objectContaining({
        source: 'gsmap_gauge_now',
        validTime: new Date('2026-10-06T14:00:00Z'),
        nx: 550,
        ny: 250,
        encoding: 'float32le+gzip',
      }),
    );
    const values = decodeRainGrid(stored.data as Buffer, 550 * 250);
    const jakarta = domainCell(INDONESIA_RAIN_DOMAIN, -6.2, 106.8)!;
    expect(values[jakarta.line * 550 + jakarta.column]).toBeCloseTo(4.5);
    const pidie = domainCell(INDONESIA_RAIN_DOMAIN, 5.3, 96.0)!;
    expect(Number.isNaN(values[pidie.line * 550 + pidie.column])).toBe(true);
    expect(stored.missingCells).toBe(1);
  });

  it('re-fetches a gauge hour whose points exist but whose grid does not', async () => {
    const hour = new Date('2026-10-06T14:00:00Z');
    const { service, download } = build({
      files: ['gsmap_gauge_now.20261006.1300.dat.gz'],
      stored: [{ source: 'gsmap_gauge_now', valid_time: hour, n: '2' }],
    });
    await service.ingest(NOW);
    expect(download).toHaveBeenCalledTimes(1);

    const complete = build({
      files: ['gsmap_gauge_now.20261006.1300.dat.gz'],
      stored: [{ source: 'gsmap_gauge_now', valid_time: hour, n: '2' }],
      storedGrids: [{ valid_time: hour }],
    });
    await complete.service.ingest(NOW);
    expect(complete.download).not.toHaveBeenCalled();
  });

  it('skips hours already stored for every district', async () => {
    const { service, download } = build({
      stored: [
        {
          source: 'gsmap_now',
          valid_time: new Date('2026-10-06T13:00:00Z'),
          n: '2',
        },
        // Only one of two districts stored → re-ingested.
        {
          source: 'gsmap_now',
          valid_time: new Date('2026-10-06T14:00:00Z'),
          n: '1',
        },
      ],
    });

    const summary = await service.ingest(NOW);

    expect(summary?.filesAlreadyStored).toBe(1);
    expect(download).not.toHaveBeenCalledWith('gsmap_now.20261006.1200.dat.gz');
    expect(download).toHaveBeenCalledWith('gsmap_now.20261006.1300.dat.gz');
  });

  it('isolates a failed download and keeps going', async () => {
    const download = jest.fn(async (name: string) => {
      if (name === 'gsmap_now.20261006.1300.dat.gz') {
        throw new Error('550 file unavailable');
      }
      return grid(1);
    });
    const { service, sync } = build({ download });

    const summary = await service.ingest(NOW);

    expect(summary).toEqual(
      expect.objectContaining({ filesIngested: 2, filesFailed: 1 }),
    );
    expect(sync.recordSuccess).toHaveBeenCalled();
  });

  it('records a failure when every download fails', async () => {
    const { service, sync } = build({
      download: jest.fn().mockRejectedValue(new Error('timeout')),
    });

    await service.ingest(NOW);

    expect(sync.recordFailure).toHaveBeenCalledWith(
      'rainfall_gsmap_now',
      expect.stringContaining('failed'),
    );
  });

  it('rejects a truncated grid instead of storing garbage', async () => {
    const { service, inserted } = build({
      download: jest.fn().mockResolvedValue(Buffer.alloc(10)),
    });

    const summary = await service.ingest(NOW);

    expect(summary?.filesFailed).toBe(3);
    expect(inserted).toHaveLength(0);
  });

  it('does nothing without FTP credentials', async () => {
    const { service, ftp } = build({ configured: false });

    const summary = await service.ingest(NOW);

    expect(summary?.status).toBe('not_configured');
    expect(ftp.withSession).not.toHaveBeenCalled();
    expect(service.getLastSummary()?.status).toBe('not_configured');
  });

  it('starts at most one background run', async () => {
    const { service } = build();
    expect(service.startInBackground()).toBe(true);
    expect(service.isRunning()).toBe(true);
    expect(service.startInBackground()).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
  });
});
