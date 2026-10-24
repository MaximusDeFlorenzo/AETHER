import { GSMAP_GRID_BYTES, gsmapCell, GSMAP_NX } from './lib/gsmap';
import { GsmapArchiveService } from './gsmap-archive.service';

const POINT = { id: 'd1', latitude: -6.2, longitude: 106.8 };

function grid(value: number): Buffer {
  const buffer = Buffer.alloc(GSMAP_GRID_BYTES);
  const cell = gsmapCell(POINT.latitude, POINT.longitude)!;
  buffer.writeFloatLE(value, (cell.line * GSMAP_NX + cell.column) * 4);
  return buffer;
}

function build(opts: {
  dirs: Record<string, string[] | null>;
  complete?: string[];
}) {
  const downloads: string[] = [];
  const session = {
    listFiles: jest.fn(async (dir: string) =>
      dir in opts.dirs ? opts.dirs[dir] : null,
    ),
    downloadGz: jest.fn(async (path: string) => {
      downloads.push(path);
      return grid(Number(/\.(\d{2})00\.v8/.exec(path)![1]) / 10);
    }),
  };
  const ftp = {
    isConfigured: () => true,
    withSession: jest.fn((work: (s: unknown) => Promise<unknown>) =>
      work(session),
    ),
  };
  const districtQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([
      {
        id: POINT.id,
        latitude: String(POINT.latitude),
        longitude: String(POINT.longitude),
      },
    ]),
  };
  const archive = {
    query: jest
      .fn()
      .mockResolvedValue((opts.complete ?? []).map((day) => ({ day }))),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new GsmapArchiveService(
    ftp as never,
    config as never,
    { createQueryBuilder: () => districtQb } as never,
    archive as never,
  );
  return { service, archive, downloads, session };
}

const hours = (stamp: string, count = 24) =>
  Array.from(
    { length: count },
    (_, h) =>
      `gsmap_gauge.${stamp}.${String(h).padStart(2, '0')}00.v8.1000.0.dat.gz`,
  );
const NOW = new Date('2024-01-10T06:00:00Z'); // newest published day: Jan 7

describe('GsmapArchiveService', () => {
  it('stores each missing day once all its hours are read, skipping complete days', async () => {
    const { service, archive, downloads } = build({
      dirs: {
        '/standard/v8/hourly_G/2024/01/02': hours('20240102'),
      },
      complete: ['2024-01-01'],
    });
    const summary = await service.backfill(
      {
        from: new Date(Date.UTC(2024, 0, 1)),
        to: new Date(Date.UTC(2024, 0, 2)),
      },
      NOW,
    );
    expect(summary).toEqual(
      expect.objectContaining({ daysStored: 1, daysAlreadyComplete: 1 }),
    );
    expect(downloads).toHaveLength(24);
    const [rows] = archive.upsert.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(rows[0]).toEqual(
      expect.objectContaining({
        districtId: 'd1',
        product: 'gsmap_gauge_v8',
        day: '2024-01-02',
        missingHours: 0,
        productVersion: 'v8.1000.0',
      }),
    );
    expect((rows[0].hourlyMm as number[])[13]).toBeCloseTo(1.3);
  });

  it('stops at a day that is not (fully) published yet, but keeps old gaps', async () => {
    const { service, archive } = build({
      dirs: {
        '/standard/v8/hourly_G/2024/01/05': hours('20240105', 20), // old: gaps kept
        '/standard/v8/hourly_G/2024/01/06': hours('20240106', 12), // recent: retry later
      },
    });
    const summary = await service.backfill(
      { from: new Date(Date.UTC(2024, 0, 5)) },
      NOW,
    );
    expect(summary?.daysStored).toBe(1);
    expect(summary?.missingHours).toBe(4);
    expect(summary?.stoppedReason).toBe('2024-01-06 only partly published');
    const [rows] = archive.upsert.mock.calls[0] as [
      Array<{ missingHours: number }>,
    ];
    expect(rows[0].missingHours).toBe(4);
  });

  it('spreads days over parallel FTP sessions', async () => {
    const { service, archive } = build({
      dirs: {
        '/standard/v8/hourly_G/2024/01/01': hours('20240101'),
        '/standard/v8/hourly_G/2024/01/02': hours('20240102'),
        '/standard/v8/hourly_G/2024/01/03': hours('20240103'),
      },
    });
    const summary = await service.backfill(
      {
        from: new Date(Date.UTC(2024, 0, 1)),
        to: new Date(Date.UTC(2024, 0, 3)),
        connections: 2,
      },
      NOW,
    );
    expect(summary?.daysStored).toBe(3);
    const days = archive.upsert.mock.calls.map(
      (c) => (c[0] as Array<{ day: string }>)[0].day,
    );
    expect(days.sort()).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
  });

  it('reopens a failed FTP session and retries the day', async () => {
    const { service, archive, session } = build({
      dirs: { '/standard/v8/hourly_G/2024/01/01': hours('20240101') },
    });
    (service as unknown as { pause: () => Promise<void> }).pause = () =>
      Promise.resolve();
    session.downloadGz.mockRejectedValueOnce(
      new Error("Can't open data connection in passive mode"),
    );
    const summary = await service.backfill(
      {
        from: new Date(Date.UTC(2024, 0, 1)),
        to: new Date(Date.UTC(2024, 0, 1)),
      },
      NOW,
    );
    expect(summary?.daysStored).toBe(1);
    expect(archive.upsert).toHaveBeenCalledTimes(1);
  });

  it('honours maxDays and never asks beyond the 3-day latency', async () => {
    const { service } = build({ dirs: {} });
    const summary = await service.backfill(
      { from: new Date(Date.UTC(2024, 0, 1)), maxDays: 0 },
      NOW,
    );
    expect(summary).toEqual(
      expect.objectContaining({ to: '2024-01-07', daysStored: 0 }),
    );
  });
});
