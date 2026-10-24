import { RainfallSpatialModelService } from './rainfall-spatial-model.service';
import { INDONESIA_RAIN_DOMAIN } from './lib/gsmap';
import { encodeRainGrid } from './lib/rain-grid-codec';
import { domainCell } from './lib/verification';

const HOUR_MS = 3_600_000;
const T0 = new Date('2026-10-01T00:00:00Z');
const CELLS = INDONESIA_RAIN_DOMAIN.nx * INDONESIA_RAIN_DOMAIN.ny;
// District point -6.2, 106.8 → its cell; rain there on odd hours.
const LAT = -6.2;
const LON = 106.8;

function cellIndex() {
  const cell = domainCell(INDONESIA_RAIN_DOMAIN, LAT, LON)!;
  return cell.line * INDONESIA_RAIN_DOMAIN.nx + cell.column;
}

function gridRow(t: Date) {
  const values = new Float32Array(CELLS);
  if (Math.round((t.getTime() - T0.getTime()) / HOUR_MS) % 2 === 1) {
    values[cellIndex()] = 5;
  }
  return {
    source: 'gsmap_gauge_now',
    validTime: t,
    ...INDONESIA_RAIN_DOMAIN,
    data: encodeRainGrid(values),
    missingCells: 0,
  };
}

function build(hours: number) {
  const times = Array.from(
    { length: hours },
    (_, i) => new Date(T0.getTime() + i * HOUR_MS),
  );
  const gridQb: Record<string, jest.Mock> = {};
  let range: { from: Date; to: Date } = { from: T0, to: T0 };
  gridQb.where = jest.fn(() => gridQb);
  gridQb.andWhere = jest.fn(
    (_sql: string, params: { from: Date; to: Date }) => {
      range = params;
      return gridQb;
    },
  );
  gridQb.orderBy = jest.fn(() => gridQb);
  gridQb.getMany = jest.fn(() =>
    Promise.resolve(
      times
        .filter((t) => t >= range.from && t <= range.to)
        .map((t) => gridRow(t)),
    ),
  );
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest
    .fn()
    .mockResolvedValue([
      { id: 'd1', latitude: String(LAT), longitude: String(LON) },
    ]);
  const predictRainNowcast = jest.fn(
    (request: {
      current: { validTime: string };
      previous?: { validTime: string };
    }) =>
      Promise.resolve({
        thresholdMmPerHour: 1,
        spatialFeatureNames: ['f'],
        points: [
          {
            id: 'd1',
            // Encode the issue hour so the test can check labels.
            spatialFeatures: {
              '1': [new Date(request.current.validTime).getUTCHours()],
              '2': null,
              '3': [0],
            },
          },
        ],
      }),
  );
  const trainRainNowcastSpatial = jest.fn().mockResolvedValue({
    modelVersion: 'rain-nowcast-spatial-logistic-v0.1',
    featureNames: ['f'],
    historyDays: 1,
    gate: { minHistoryDays: 14, minTestPositives: 100, minBssGain: 0.01 },
    horizons: [
      { horizonHours: 1, promoted: false, gateReasons: ['history'] },
      { horizonHours: 3, promoted: true, gateReasons: [] },
    ],
  });
  const runRepository = {
    create: jest.fn((x: object) => ({ ...x })),
    save: jest.fn((x: object) => Promise.resolve({ id: 'm1', ...x })),
    findOne: jest.fn(),
  };
  const service = new RainfallSpatialModelService(
    { predictRainNowcast, trainRainNowcastSpatial } as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    {
      query: jest.fn().mockResolvedValue(times.map((t) => ({ valid_time: t }))),
      createQueryBuilder: jest.fn(() => gridQb),
    } as never,
    { query: jest.fn().mockResolvedValue([]) } as never,
    runRepository as never,
  );
  return { service, predictRainNowcast, trainRainNowcastSpatial };
}

describe('RainfallSpatialModelService', () => {
  it('replays stored hours, labels from the field at t + h, and persists the verdict', async () => {
    const { service, predictRainNowcast, trainRainNowcastSpatial } = build(30);
    const run = await service.train(
      'manual',
      new Date(T0.getTime() + 30 * HOUR_MS),
    );

    // Starts need t−1 and t+1: hours 1…28; minus 6 embargoed hours.
    expect(run?.dataSummary).toEqual(
      expect.objectContaining({
        startHours: 28,
        embargoedStartHours: 6,
        startHoursReplayed: 22,
      }),
    );
    expect(predictRainNowcast).toHaveBeenCalledTimes(22);
    // Engine sees only fields up to t: previous is t−1, never t+1.
    const first = predictRainNowcast.mock.calls[0][0];
    expect(new Date(first.previous!.validTime).getTime()).toBe(
      new Date(first.current.validTime).getTime() - HOUR_MS,
    );

    const request = trainRainNowcastSpatial.mock.calls[0][0];
    // Horizon 1 rows: feature = issue hour; label = rain at t+1 (odd hour).
    const h1 = request.rows.filter((r: number[]) => r[0] === 1);
    for (const [, , label, weight, hour] of h1) {
      expect(weight).toBe(1);
      expect(label).toBe((hour + 1) % 2);
    }
    // Horizon 2 had no features; horizon 3 rows exist where t+3 is stored.
    expect(request.rows.some((r: number[]) => r[0] === 2)).toBe(false);
    expect(request.rows.some((r: number[]) => r[0] === 3)).toBe(true);

    expect(run?.status).toBe('completed');
    expect(run?.promotedHorizons).toEqual([3]);
    expect(run?.parameters).toEqual(
      expect.objectContaining({ featureNames: ['f'], historyDays: 1 }),
    );
  });

  it('refuses too little history without calling the engine', async () => {
    const { service, predictRainNowcast } = build(6);
    const run = await service.train(
      'scheduled',
      new Date(T0.getTime() + 6 * HOUR_MS),
    );
    expect(run?.status).toBe('insufficient_data');
    expect(run?.warnings[0]).toMatch(/usable start hour/);
    expect(predictRainNowcast).not.toHaveBeenCalled();
  });
});
