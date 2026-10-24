import type { RainHazardReplayRequest } from './rainfall-engine.client';
import { RainfallHazardBacktestService } from './rainfall-hazard-backtest.service';

const NOW = new Date('2024-04-01T00:00:00Z');

function build(
  opts: {
    archive?: { first: string; last: string } | null;
    labels?: number;
  } = {},
) {
  const archiveRange =
    opts.archive === undefined
      ? { first: '2024-01-01', last: '2024-03-15' }
      : opts.archive;
  const districtQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([
      { id: 'jkt', code: '31.71' },
      { id: 'ambon', code: '81.71' },
      { id: 'odd', code: '99.01' }, // no known time zone → left out
    ]),
  };
  const archive = {
    query: jest
      .fn()
      .mockResolvedValue([
        archiveRange
          ? { first: archiveRange.first, last: archiveRange.last, missing: '3' }
          : { first: null, last: null, missing: null },
      ]),
    find: jest
      .fn()
      .mockResolvedValue([
        { districtId: 'jkt', day: '2024-01-10', hourlyMm: Array(24).fill(1) },
      ]),
  };
  const labelRows = Array.from({ length: opts.labels ?? 2 }, (_, i) => ({
    districtId: i % 2 ? 'ambon' : 'jkt',
    localDate: '2024-01-20',
    hazard: i % 2 ? 'landslide' : 'flood',
  }));
  const labelQb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ last: '2024-03-30' }),
  };
  const labels = {
    find: jest.fn().mockResolvedValue(labelRows),
    createQueryBuilder: () => labelQb,
  };
  const engine = {
    replayRainHazardRules: jest.fn(async (req: RainHazardReplayRequest) => ({
      modelVersions: { flood: 'f', landslide: 'l' },
      points: req.points.map((p) => ({
        id: p.id,
        floodLevel: Array(req.days).fill(p.id === 'jkt' ? 1 : 0),
        floodTrigger: Array(req.days).fill(1),
        landslideLevel: Array(req.days).fill(-1),
        landslideTrigger: Array(req.days).fill(-1),
      })),
    })),
    evaluateRainHazardBacktest: jest.fn().mockResolvedValue({
      modelVersion: 'rain-hazard-backtest-v0.1',
      hazards: [{ hazard: 'flood' }, { hazard: 'landslide' }],
    }),
  };
  const runs = {
    create: jest.fn((x: object) => ({ ...x })),
    save: jest.fn(async (x: object) => ({ id: 'run1', ...x })),
  };
  const service = new RainfallHazardBacktestService(
    engine as never,
    {
      load: jest.fn().mockResolvedValue(new Map([['jkt', { valueMean: 0.8 }]])),
    } as never,
    {
      load: jest
        .fn()
        .mockResolvedValue(new Map([['ambon', { slopeSamplesDeg: [10, 20] }]])),
    } as never,
    { createQueryBuilder: () => districtQb } as never,
    archive as never,
    labels as never,
    runs as never,
  );
  return { service, engine, archive };
}

describe('RainfallHazardBacktestService', () => {
  it('replays the archive month by month and scores it on a 60/40 time split', async () => {
    const { service, engine, archive } = build();
    const run = await service.run('manual', NOW);
    expect(run?.status).toBe('completed');
    // 2024-01-06 … 2024-03-15 = 70 local days → chunks of 31, 31, 8.
    const replays = engine.replayRainHazardRules.mock.calls.map((c) => c[0]);
    expect(replays.map((r) => [r.firstDay, r.days])).toEqual([
      ['2024-01-06', 31],
      ['2024-02-06', 31],
      ['2024-03-08', 8],
    ]);
    expect(replays[0].seriesStart).toBe('2024-01-01T01:00:00.000Z');
    expect(replays[0].hours).toBe(36 * 24);
    expect(replays[0].points).toEqual([
      {
        id: 'jkt',
        utcOffsetHours: 7,
        floodHazardIndex: 0.8,
        slopeSamplesDeg: null,
      },
      {
        id: 'ambon',
        utcOffsetHours: 9,
        floodHazardIndex: null,
        slopeSamplesDeg: [10, 20],
      },
    ]);
    expect(archive.find).toHaveBeenCalledTimes(3);

    const evaluation = engine.evaluateRainHazardBacktest.mock.calls[0][0];
    expect(evaluation).toEqual(
      expect.objectContaining({
        firstDay: '2024-01-06',
        points: 2,
        days: 70,
        testStartDay: 42,
      }),
    );
    const flood = evaluation.hazards[0];
    const levels = Int8Array.from(Buffer.from(flood.levelsB64, 'base64'));
    expect(levels[0]).toBe(1); // jkt
    expect(levels[70]).toBe(0); // ambon
    const events = Int8Array.from(Buffer.from(flood.eventsB64, 'base64'));
    expect(events[14]).toBe(1); // jkt, 2024-01-20
    expect(events.reduce((a, b) => a + b, 0)).toBe(1);
    expect(run?.dataSummary).toEqual(
      expect.objectContaining({
        days: 70,
        testStartDay: '2024-02-17',
        evaluableDistrictDays: { flood: 140, landslide: 0 },
        districtDaysWithEvents: { flood: 1, landslide: 1 },
      }),
    );
    expect(run?.warnings.join(' ')).toMatch(/gauge floor never applies/);
  });

  it('refuses without archive, too short an archive, or labels', async () => {
    expect(
      (await build({ archive: null }).service.run('manual', NOW))?.status,
    ).toBe('insufficient_data');
    const short = build({
      archive: { first: '2024-01-01', last: '2024-02-01' },
    });
    const run = await short.service.run('manual', NOW);
    expect(run?.status).toBe('insufficient_data');
    expect(run?.error).toMatch(/27 evaluable days/);
    const noLabels = build({ labels: 0 });
    expect((await noLabels.service.run('manual', NOW))?.error).toMatch(
      /No DIBI labels/,
    );
    expect(noLabels.engine.replayRainHazardRules).not.toHaveBeenCalled();
  });
});
