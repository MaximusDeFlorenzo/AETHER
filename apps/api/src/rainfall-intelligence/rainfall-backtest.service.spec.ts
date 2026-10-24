import { INDONESIA_RAIN_DOMAIN } from './lib/gsmap';
import { encodeRainGrid } from './lib/rain-grid-codec';
import { domainCell } from './lib/verification';
import { RainfallBacktestService } from './rainfall-backtest.service';

const HOUR_MS = 3_600_000;
const T0 = new Date('2026-10-06T10:00:00Z');
const CELLS = INDONESIA_RAIN_DOMAIN.nx * INDONESIA_RAIN_DOMAIN.ny;
const JAKARTA = domainCell(INDONESIA_RAIN_DOMAIN, -6.2, 106.8)!;

/** Field that is dry except `mm` at Jakarta's cell. */
function gridRow(hour: number, mm: number) {
  const values = new Float32Array(CELLS);
  values[JAKARTA.line * INDONESIA_RAIN_DOMAIN.nx + JAKARTA.column] = mm;
  return {
    validTime: new Date(T0.getTime() + hour * HOUR_MS),
    ...INDONESIA_RAIN_DOMAIN,
    data: encodeRainGrid(values),
    missingCells: 0,
  };
}

/** Engine stub: movement always toward the east; probabilities fixed. */
function engineResponse(probabilityByMethod: Record<string, number>) {
  return (request: { current: { validTime: string } }) =>
    Promise.resolve({
      modelVersions: { motion: 'm', nowcast: 'n' },
      issuedAt: request.current.validTime,
      dataValidTime: request.current.validTime,
      thresholdMmPerHour: 1,
      calibrated: false,
      gridMissingFraction: 0,
      points: [
        {
          id: 'jkt',
          currentMmPerHour: 0,
          movement: {
            status: 'ok',
            towardDeg: 90,
            confidence: 'low',
          },
          forecasts: Object.entries(probabilityByMethod).flatMap(
            ([method, probability]) =>
              [1, 2, 3].map((horizonHours) => ({
                method,
                horizonHours,
                status: 'ok',
                probability,
              })),
          ),
        },
      ],
    });
}

function build(grids: unknown[], engine: jest.Mock) {
  const gridQb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy']) {
    gridQb[m] = jest.fn(() => gridQb);
  }
  gridQb.getMany = jest.fn().mockResolvedValue(grids);
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest
    .fn()
    .mockResolvedValue([{ id: 'jkt', latitude: '-6.2', longitude: '106.8' }]);
  // Model winds: 700 hPa FROM the west (toward east, matches the motion),
  // 10 m FROM the east (toward west, opposite).
  const winds = Array.from({ length: 8 }, (_, h) => ({
    district_id: 'jkt',
    valid_time: new Date(T0.getTime() + (h - 2) * HOUR_MS),
    wind_speed_10m_kmh: 5,
    wind_from_10m_deg: 90,
    wind_speed_850hpa_kmh: 10,
    wind_from_850hpa_deg: 0,
    wind_speed_700hpa_kmh: 20,
    wind_from_700hpa_deg: 270,
  }));
  return new RainfallBacktestService(
    { predictRainNowcast: engine } as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    { createQueryBuilder: jest.fn(() => gridQb) } as never,
    { query: jest.fn().mockResolvedValue(winds) } as never,
  );
}

describe('RainfallBacktestService', () => {
  // Rain (5 mm) at Jakarta in hours 2 and 3; dry otherwise.
  const grids = [0, 1, 2, 3, 4].map((h) =>
    gridRow(h, h === 2 || h === 3 ? 5 : 0),
  );
  const now = new Date(T0.getTime() + 4.5 * HOUR_MS);

  it('scores each method × horizon against the field observed at t+h', async () => {
    const engine = jest.fn(
      engineResponse({ persistence: 1, motion_advection: 0 }),
    );
    const result = await build(grids, engine).backtest(24, now);

    // Start hours need t−1 and t+1: hours 1, 2, 3.
    expect(result?.status).toBe('completed');
    expect(result?.startTimesEvaluated).toBe(3);
    const persistence1h = result?.methods.find(
      (m) => m.method === 'persistence' && m.horizonHours === 1,
    )?.score;
    // Observed at t+1 for t = 1, 2, 3 → hours 2, 3, 4 → rain, rain, dry.
    expect(persistence1h).toEqual(
      expect.objectContaining({
        n: 3,
        observedFrequency: 0.667,
        brierScore: 0.333,
      }),
    );
    expect(persistence1h?.contingency).toEqual(
      expect.objectContaining({ hits: 2, falseAlarms: 1, misses: 0 }),
    );
    // Horizon 3 from t=1 → hour 4 only (later ones fall outside the data).
    expect(
      result?.methods.find(
        (m) => m.method === 'motion_advection' && m.horizonHours === 3,
      )?.score.n,
    ).toBe(1);
    // A method the engine never issued has no samples, not fake zeros.
    expect(
      result?.methods.find((m) => m.method === 'steering_wind_advection')?.score
        .n,
    ).toBe(0);
  });

  it('validates wind direction against the motion that actually happened', async () => {
    const engine = jest.fn(engineResponse({ persistence: 0 }));
    const result = await build(grids, engine).backtest(24, now);
    const score = (p: string) =>
      result?.direction.find((d) => d.predictor === p)?.score;
    // Realized motion is toward 90° every hour.
    expect(score('tracked_motion_persistence')?.medianAbsErrorDeg).toBe(0);
    expect(score('wind_700hPa')?.medianAbsErrorDeg).toBe(0); // from 270 → toward 90
    expect(score('wind_10m')?.medianAbsErrorDeg).toBe(180); // toward 270
    expect(score('wind_850hPa')?.medianAbsErrorDeg).toBe(90); // toward 180
    // Each start hour's engine run is reused as the next one's truth.
    expect(engine).toHaveBeenCalledTimes(4);
  });

  it('needs three consecutive fields', async () => {
    const engine = jest.fn();
    const result = await build([gridRow(0, 0), gridRow(2, 0)], engine).backtest(
      24,
      now,
    );
    expect(result?.status).toBe('insufficient_data');
    expect(result?.warnings[0]).toMatch(/three consecutive/);
    expect(engine).not.toHaveBeenCalled();
  });
});
