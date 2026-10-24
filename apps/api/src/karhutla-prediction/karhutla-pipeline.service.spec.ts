import { KarhutlaPipelineService } from './karhutla-pipeline.service';
import { KarhutlaForecastStatus, KarhutlaRunStatus } from './karhutla.enums';
import type { AtmosphereSeries } from './providers/open-meteo-atmosphere.provider';

const NOW = new Date('2026-09-20T06:00:30Z');

function hotspotRow(
  id: string,
  lat: number,
  lon: number,
  hoursAgo: number,
  confidence = '85',
) {
  return {
    id,
    latitude: lat,
    longitude: lon,
    eventTime: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    externalId: id,
    rawPayload: {
      frp: '40',
      scan: '1',
      track: '1',
      confidence,
      satellite: 'Aqua',
      instrument: 'MODIS',
    },
  };
}

function series(p: { latitude: number; longitude: number }): AtmosphereSeries {
  return {
    ...p,
    elevationM: 20,
    retrievedAt: NOW.toISOString(),
    hours: Array.from({ length: 40 }, (_, i) => ({
      time: new Date(NOW.getTime() + (i - 25) * 3_600_000).toISOString(),
      windSpeed10mKmh: 12,
      windFrom10mDeg: 90,
      temperatureC: 32,
      relativeHumidityPct: 50,
      precipitationMm: 0,
      boundaryLayerHeightM: 900,
      levels: [{ heightAglM: 10, windSpeedKmh: 12, windFromDeg: 90 }],
    })),
  };
}

const okHorizon = (h: number) => ({
  horizonHours: h,
  validAt: new Date(NOW.getTime() + h * 3_600_000).toISOString(),
  status: 'ok',
  envelope: {
    type: 'Polygon',
    coordinates: [
      [
        [113.8, -2.3],
        [114.0, -2.3],
        [114.0, -2.1],
        [113.8, -2.1],
        [113.8, -2.3],
      ],
    ],
  },
  footprint: [],
});

function build(
  rows = [hotspotRow('a', -2.2, 113.9, 2), hotspotRow('b', -2.205, 113.9, 2)],
) {
  const run = {
    id: 'run-1',
    status: KarhutlaRunStatus.QUEUED,
    horizonsHours: [1, 3],
    maxClusters: 5,
    hotspotWindowHours: 24,
  };
  const runRepository = {
    findOne: jest.fn().mockResolvedValue(run),
    update: jest.fn().mockResolvedValue({}),
  };
  const forecastRepository = {
    delete: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  };
  const hazardEventRepository = { find: jest.fn().mockResolvedValue(rows) };
  const districtRepository = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'd1',
        name: 'Kota Palangka Raya',
        province: { name: 'Kalimantan Tengah' },
        geom: { type: 'Point', coordinates: [113.92, -2.21] },
      },
    ]),
  };
  const atmosphere = { fetch: jest.fn(async (points) => points.map(series)) };
  const terrain = { rings: jest.fn(async (c) => c.map(() => null)) };
  const settlements = {
    enabled: true,
    around: jest.fn().mockResolvedValue([]),
  };
  const engine = {
    predictFireSpread: jest.fn().mockResolvedValue({
      modelVersion: 'karhutla-spread-ellipse-v0.1',
      confidence: 'low',
      observedFootprint: { type: 'Polygon', coordinates: [] },
      horizons: [okHorizon(1), okHorizon(3)],
    }),
    predictSmokeTransport: jest.fn().mockResolvedValue({
      modelVersion: 'karhutla-smoke-lagrangian-v0.1',
      confidence: 'low',
      qualitative: true,
      horizons: [okHorizon(1), okHorizon(3)],
    }),
  };
  const service = new KarhutlaPipelineService(
    runRepository as never,
    forecastRepository as never,
    hazardEventRepository as never,
    districtRepository as never,
    atmosphere as never,
    terrain as never,
    settlements as never,
    engine as never,
  );
  return {
    service,
    run,
    runRepository,
    forecastRepository,
    engine,
    atmosphere,
  };
}

beforeAll(() =>
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'setImmediate', 'nextTick'],
  }),
);
afterAll(() => jest.useRealTimers());

const lastRunUpdate = (repo: { update: jest.Mock }) =>
  repo.update.mock.calls[repo.update.mock.calls.length - 1][1];

describe('KarhutlaPipelineService.execute', () => {
  it('produces one forecast per cluster and completes the run with model versions', async () => {
    const { service, runRepository, forecastRepository, engine } = build();
    await service.execute('run-1');
    expect(engine.predictFireSpread).toHaveBeenCalledTimes(1);
    const spreadReq = engine.predictFireSpread.mock.calls[0][0];
    expect(spreadReq.issuedAt).toBe('2026-09-20T06:00:00.000Z'); // floored to the minute
    expect(spreadReq.hotspots).toHaveLength(2);
    const saved = forecastRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(KarhutlaForecastStatus.OK);
    expect(saved.locationLabel).toMatch(/Palangka Raya/);
    expect(saved.exposure[0].spread.map((p: { id: string }) => p.id)).toContain(
      'd1',
    );
    expect(saved.spread).not.toHaveProperty('observedFootprint');
    expect(lastRunUpdate(runRepository)).toMatchObject({
      status: KarhutlaRunStatus.COMPLETED,
      spreadModelVersion: 'karhutla-spread-ellipse-v0.1',
      smokeModelVersion: 'karhutla-smoke-lagrangian-v0.1',
    });
  });

  it('excludes future-timestamped, low-confidence and duplicate hotspots and counts them', async () => {
    const rows = [
      hotspotRow('a', -2.2, 113.9, 2),
      { ...hotspotRow('dup', -2.2, 113.9, 2) },
      hotspotRow('low', -2.21, 113.9, 2, '12'),
      hotspotRow('future', -2.2, 113.9, -3),
    ];
    const { service, runRepository, engine } = build(rows);
    await service.execute('run-1');
    const summary = lastRunUpdate(runRepository).inputSummary;
    expect(summary).toMatchObject({
      excludedFutureTimestamps: 1,
      duplicatesRemoved: 1,
      excludedLowConfidence: 1,
      hotspotsUsed: 1,
    });
    expect(lastRunUpdate(runRepository).warnings[0]).toMatch(
      /after the run's issue time/,
    );
    expect(engine.predictFireSpread.mock.calls[0][0].hotspots).toHaveLength(1);
  });

  it('keeps going when one engine fails or times out: partial forecast, error recorded', async () => {
    const { service, runRepository, forecastRepository, engine } = build();
    engine.predictSmokeTransport.mockRejectedValue(
      new Error('timeout of 45000ms exceeded'),
    );
    await service.execute('run-1');
    const saved = forecastRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(KarhutlaForecastStatus.PARTIAL);
    expect(saved.smoke).toBeNull();
    expect(saved.error).toMatch(/Smoke engine: timeout/);
    expect(saved.confidence).toBe('very_low');
    expect(lastRunUpdate(runRepository).status).toBe(KarhutlaRunStatus.PARTIAL);
  });

  it('surfaces the engine 422 detail for conflicting inputs', async () => {
    const { service, forecastRepository, engine } = build();
    engine.predictFireSpread.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: 'Hotspot observed after issuedAt' },
      },
    });
    engine.predictSmokeTransport.mockRejectedValue({
      response: { status: 422, data: { detail: 'bad' } },
    });
    await service.execute('run-1');
    const saved = forecastRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(KarhutlaForecastStatus.FAILED);
    expect(saved.error).toMatch(/Hotspot observed after issuedAt/);
    expect(saved.confidence).toBeNull();
  });

  it('does not call the spread engine when weather is unavailable', async () => {
    const { service, forecastRepository, engine, atmosphere } = build();
    atmosphere.fetch.mockImplementation(async (points: unknown[]) =>
      points.map(() => null),
    );
    await service.execute('run-1');
    expect(engine.predictFireSpread).not.toHaveBeenCalled();
    expect(engine.predictSmokeTransport).not.toHaveBeenCalled();
    const saved = forecastRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(KarhutlaForecastStatus.FAILED);
    expect(saved.dataQuality.issues.join(' ')).toMatch(/No surface weather/);
  });

  it('completes with no forecasts when there are no eligible hotspots', async () => {
    const { service, runRepository, engine } = build([]);
    await service.execute('run-1');
    expect(engine.predictFireSpread).not.toHaveBeenCalled();
    expect(lastRunUpdate(runRepository)).toMatchObject({
      status: KarhutlaRunStatus.COMPLETED,
    });
  });

  it('is a no-op for a redelivered job whose run already finished', async () => {
    const { service, run, runRepository, engine } = build();
    run.status = KarhutlaRunStatus.COMPLETED;
    await service.execute('run-1');
    expect(runRepository.update).not.toHaveBeenCalled();
    expect(engine.predictFireSpread).not.toHaveBeenCalled();
  });
});
