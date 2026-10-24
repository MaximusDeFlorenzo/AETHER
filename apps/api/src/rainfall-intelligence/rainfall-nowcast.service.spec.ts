import { NotFoundException } from '@nestjs/common';
import { INDONESIA_RAIN_DOMAIN } from './lib/gsmap';
import { encodeRainGrid } from './lib/rain-grid-codec';
import { windAt, type WindHour } from './rain-inputs.store';
import {
  buildNowcastRequest,
  RainfallNowcastService,
} from './rainfall-nowcast.service';

const HOUR_MS = 3_600_000;
const T = new Date('2026-10-06T14:00:00Z');
const CELLS = INDONESIA_RAIN_DOMAIN.nx * INDONESIA_RAIN_DOMAIN.ny;

function gridRow(validTime: Date, value = 0) {
  return {
    validTime,
    ...INDONESIA_RAIN_DOMAIN,
    data: encodeRainGrid(new Float32Array(CELLS).fill(value)),
    missingCells: 0,
  };
}

function windHour(validTime: Date, fromDeg = 270): WindHour {
  return {
    validTime,
    '10m': { speedKmh: 5, fromDeg: 90 },
    '850hPa': { speedKmh: 15, fromDeg: 200 },
    '700hPa': { speedKmh: 25, fromDeg },
  };
}

const ENGINE_RESPONSE = {
  modelVersions: {
    motion: 'rain-motion-blockmatch-v0.1',
    nowcast: 'rain-nowcast-baselines-v0.1',
  },
  issuedAt: T.toISOString(),
  dataValidTime: T.toISOString(),
  thresholdMmPerHour: 1,
  calibrated: false,
  gridMissingFraction: 0.01,
  spatialFeatureNames: ['f'],
  spatialModelNote: null,
  points: [
    {
      id: 'd1',
      currentMmPerHour: 0,
      movement: {},
      forecasts: [],
      spatialFeatures: { '1': [0.5] },
    },
  ],
};

function build({
  grids = [gridRow(new Date(T.getTime() - HOUR_MS)), gridRow(T)],
  winds = [
    {
      district_id: 'd1',
      valid_time: new Date(T.getTime() - 2 * HOUR_MS),
      wind_speed_10m_kmh: 5,
      wind_from_10m_deg: 90,
      wind_speed_850hpa_kmh: 15,
      wind_from_850hpa_deg: 200,
      wind_speed_700hpa_kmh: 25,
      wind_from_700hpa_deg: 270,
    },
  ],
  engine = jest.fn().mockResolvedValue(ENGINE_RESPONSE),
  modelRun = null as unknown,
} = {}) {
  const gridQb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy']) {
    gridQb[m] = jest.fn(() => gridQb);
  }
  gridQb.getMany = jest.fn().mockResolvedValue(grids);
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue([
    { id: 'd1', latitude: '-6.2', longitude: '106.8' },
    { id: 'd2', latitude: '-7.0', longitude: '110.4' },
  ]);
  const saved: unknown[] = [];
  const runRepository = {
    create: jest.fn((x: object) => ({ ...x })),
    save: jest.fn(async (x: object) => {
      saved.push(x);
      return { id: 'run-1', ...x };
    }),
    findOne: jest.fn(),
  };
  const service = new RainfallNowcastService(
    { predictRainNowcast: engine } as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    { createQueryBuilder: jest.fn(() => gridQb) } as never,
    { query: jest.fn().mockResolvedValue(winds) } as never,
    runRepository as never,
    { findOne: jest.fn().mockResolvedValue(modelRun) } as never,
  );
  return { service, engine, runRepository };
}

describe('windAt', () => {
  const hours = [
    windHour(new Date(T.getTime() - 5 * HOUR_MS)),
    windHour(new Date(T.getTime() - 2 * HOUR_MS)),
    windHour(new Date(T.getTime() + HOUR_MS)),
  ];

  it('takes the newest hour at or before t within the age limit', () => {
    expect(windAt(hours, T, 4 * HOUR_MS)?.validTime).toEqual(
      new Date(T.getTime() - 2 * HOUR_MS),
    );
    expect(windAt(hours, T, HOUR_MS)).toBeNull();
    expect(windAt(undefined, T, HOUR_MS)).toBeNull();
  });
});

describe('buildNowcastRequest', () => {
  it('attaches the 700 hPa wind with its own valid time, and omits it when missing', () => {
    const grid = {
      validTime: T,
      domain: INDONESIA_RAIN_DOMAIN,
      values: new Float32Array(CELLS),
      missingCells: 0,
    };
    const request = buildNowcastRequest({
      issuedAt: new Date(T.getTime() + 600_000),
      current: grid,
      previous: null,
      districts: [
        { id: 'd1', latitude: -6.2, longitude: 106.8 },
        { id: 'd2', latitude: -7, longitude: 110.4 },
      ],
      winds: new Map([['d1', [windHour(T, 300)]]]),
      maxWindAgeMs: 4 * HOUR_MS,
    });
    expect(request.previous).toBeUndefined();
    expect(request.horizonsHours).toEqual([1, 2, 3]);
    expect(request.points[0].steeringWind).toEqual({
      level: '700hPa',
      speedKmh: 25,
      fromDeg: 300,
      validTime: T.toISOString(),
    });
    expect(request.points[1].steeringWind).toBeUndefined();
    expect(Buffer.from(request.current.dataB64, 'base64')).toHaveLength(
      CELLS * 4,
    );
  });
});

describe('RainfallNowcastService.run', () => {
  it('runs the engine on the two newest fields and records provenance', async () => {
    const { service, engine } = build();
    const run = await service.run(
      'manual',
      new Date(T.getTime() + 20 * 60_000),
    );

    expect(engine).toHaveBeenCalledTimes(1);
    const request = engine.mock.calls[0][0];
    expect(request.previous.validTime).toBe(
      new Date(T.getTime() - HOUR_MS).toISOString(),
    );
    expect(run).toEqual(
      expect.objectContaining({
        status: 'completed',
        dataValidTime: T,
        previousValidTime: new Date(T.getTime() - HOUR_MS),
        rainSource: 'gsmap_gauge_now',
        modelVersions: ENGINE_RESPONSE.modelVersions,
        // Training features are not stored with the run.
        results: [
          { id: 'd1', currentMmPerHour: 0, movement: {}, forecasts: [] },
        ],
      }),
    );
    expect(request.spatialModel).toBeUndefined();
    expect(run?.inputSummary?.spatialModel).toEqual({
      note: expect.stringContaining('No spatial model has passed'),
    });
    expect(run?.inputSummary).toEqual(
      expect.objectContaining({
        rainFrames: expect.objectContaining({
          dataKind: 'satellite_estimate',
          attribution: expect.stringContaining('JAXA'),
        }),
        steeringWind: expect.objectContaining({
          dataKind: 'nwp_model',
          districtsWithWind: 1,
        }),
      }),
    );
    // d2 has no stored wind → said so.
    expect(run?.warnings).toEqual([
      expect.stringContaining('1 district(s) lack a 700hPa model wind'),
    ]);
  });

  it('passes only the promoted horizons of the newest training run to the engine', async () => {
    const { service, engine } = build({
      modelRun: {
        id: 'm1',
        modelVersion: 'rain-nowcast-spatial-logistic-v0.1',
        issuedAt: T,
        parameters: { featureNames: ['f'] },
        promotedHorizons: [1],
        results: [
          { horizonHours: 1, promoted: true, coefficients: [2], intercept: -1 },
          { horizonHours: 2, promoted: false, coefficients: [1], intercept: 0 },
        ],
      },
    });
    const run = await service.run('manual', new Date(T.getTime() + 60_000));
    expect(engine.mock.calls[0][0].spatialModel).toEqual({
      modelVersion: 'rain-nowcast-spatial-logistic-v0.1',
      trainedAt: T.toISOString(),
      featureNames: ['f'],
      horizons: { '1': { coefficients: [2], intercept: -1 } },
    });
    expect(run?.inputSummary?.spatialModel).toEqual(
      expect.objectContaining({ trainingRunId: 'm1', horizonsHours: [1] }),
    );
  });

  it('refuses to nowcast from a stale rain field', async () => {
    const { service, engine } = build();
    const run = await service.run(
      'scheduled',
      new Date(T.getTime() + 3 * HOUR_MS),
    );
    expect(engine).not.toHaveBeenCalled();
    expect(run?.status).toBe('insufficient_data');
    expect(run?.warnings[0]).toMatch(/180 min old .* nowcast refused/);
  });

  it('reports no stored field instead of failing', async () => {
    const { service } = build({ grids: [] });
    const run = await service.run('scheduled', T);
    expect(run?.status).toBe('insufficient_data');
    expect(run?.dataValidTime).toBeNull();
  });

  it('still runs without the previous hour, and says motion is unavailable', async () => {
    const { service, engine } = build({ grids: [gridRow(T)] });
    const run = await service.run('manual', T);
    expect(engine.mock.calls[0][0].previous).toBeUndefined();
    expect(run?.status).toBe('completed');
    expect(run?.warnings[0]).toMatch(/motion tracking unavailable/);
  });

  it('persists a failed run when the engine errors', async () => {
    const { service, runRepository } = build({
      engine: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const run = await service.run('manual', T);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('ECONNREFUSED');
    expect(runRepository.save).toHaveBeenCalledTimes(1);
  });
});

describe('RainfallNowcastService.latest', () => {
  it('404s with no runs and filters to one district', async () => {
    const { service, runRepository } = build();
    runRepository.findOne.mockResolvedValueOnce(null);
    await expect(service.latest()).rejects.toBeInstanceOf(NotFoundException);

    runRepository.findOne.mockResolvedValue({
      id: 'r',
      results: [{ id: 'd1' }, { id: 'd2' }],
    });
    await expect(service.latest('d2')).resolves.toEqual({
      id: 'r',
      results: [{ id: 'd2' }],
    });
    await expect(service.latest('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
