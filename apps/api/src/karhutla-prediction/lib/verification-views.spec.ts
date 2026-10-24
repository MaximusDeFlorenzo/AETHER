import { verifyForecast } from './verification';
import { toForecastView, toRunView } from './views';
import type {
  KarhutlaClusterForecast,
  KarhutlaPredictionRun,
} from '../../database/entities';
import {
  KarhutlaForecastStatus,
  KarhutlaRunStatus,
  KarhutlaRunTrigger,
} from '../karhutla.enums';

const box = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});
const issuedAt = new Date('2026-09-20T06:00:00Z');
const at = (h: number) => new Date(issuedAt.getTime() + h * 3_600_000);

describe('verifyForecast', () => {
  const result = verifyForecast({
    issuedAt,
    now: at(4),
    centroid: { latitude: 0, longitude: 0 },
    clusterHotspotIds: ['own'],
    baseline: box(-0.01, -0.01, 0.01, 0.01),
    baselineAreaKm2: 4,
    horizons: [
      {
        horizonHours: 1,
        validAt: at(1).toISOString(),
        status: 'ok',
        envelope: box(-0.05, -0.05, 0.05, 0.05),
        areaKm2: 120,
      },
      {
        horizonHours: 3,
        validAt: at(3).toISOString(),
        status: 'ok',
        envelope: box(-0.1, -0.1, 0.1, 0.1),
        areaKm2: 480,
      },
      {
        horizonHours: 6,
        validAt: at(6).toISOString(),
        status: 'ok',
        envelope: box(-0.2, -0.2, 0.2, 0.2),
        areaKm2: 1900,
      },
    ],
    laterHotspots: [
      { id: 'own', latitude: 0, longitude: 0, observedAt: at(0.5) }, // cluster's own -> ignored
      { id: 'n1', latitude: 0.005, longitude: 0, observedAt: at(0.5) }, // inside baseline + envelope
      { id: 'n2', latitude: 0.08, longitude: 0, observedAt: at(2) }, // inside 3h envelope only
      { id: 'n3', latitude: 0.2, longitude: 0, observedAt: at(2) }, // ~22 km: outside all
      { id: 'far', latitude: 2, longitude: 2, observedAt: at(2) }, // > 30 km
    ],
  });

  it('counts new nearby hotspots inside envelope vs persistence baseline', () => {
    expect(result[0]).toMatchObject({
      evaluable: true,
      newHotspots: 1,
      insideEnvelope: 1,
      insidePersistenceBaseline: 1,
    });
    expect(result[1]).toMatchObject({
      evaluable: true,
      newHotspots: 3,
      insideEnvelope: 2,
      insidePersistenceBaseline: 1,
    });
  });

  it('does not evaluate horizons whose valid time has not passed', () => {
    expect(result[2]).toMatchObject({
      evaluable: false,
      reason: 'Valid time not reached yet.',
    });
  });
});

describe('views', () => {
  const forecast = {
    id: 'f1',
    rank: 1,
    status: KarhutlaForecastStatus.OK,
    confidence: 'low',
    latitude: -2.2,
    longitude: 113.9,
    locationLabel: 'Near Kota Palangka Raya',
    nearestDistrict: { id: 'd1', name: 'Kota Palangka Raya' },
    hotspotCount: 3,
    totalFrpMw: 80,
    maxConfidence: 0.9,
    firstObservedAt: issuedAt,
    latestObservedAt: issuedAt,
    sensors: ['MODIS Aqua'],
    hotspotEventIds: ['a', 'b', 'c'],
    observedFootprint: box(0, 0, 1, 1),
    spread: { modelVersion: 'karhutla-spread-ellipse-v0.1', horizons: [] },
    smoke: {
      modelVersion: 'karhutla-smoke-lagrangian-v0.1',
      qualitative: true,
      horizons: [],
    },
    weather: null,
    dataQuality: { issues: [] },
    exposure: [],
    recommendations: [],
    error: null,
  } as unknown as KarhutlaClusterForecast;

  it('keeps observations and model outputs in separate, labelled branches', () => {
    const view = toForecastView(forecast);
    expect(view.observed.kind).toBe('observation');
    expect(view.predicted.kind).toBe('model_output');
    expect(view.observed.pixelFootprint).toEqual(box(0, 0, 1, 1));
    expect(view.observed).not.toHaveProperty('spread');
    expect(view.predicted).not.toHaveProperty('pixelFootprint');
    expect(view.observed.source).toMatch(/FIRMS/);
  });

  it('always carries the disclaimer and model versions on runs', () => {
    const run = {
      id: 'r1',
      status: KarhutlaRunStatus.COMPLETED,
      trigger: KarhutlaRunTrigger.MANUAL,
      horizonsHours: [1, 3, 6],
      spreadModelVersion: 'karhutla-spread-ellipse-v0.1',
      smokeModelVersion: 'karhutla-smoke-lagrangian-v0.1',
      warnings: [],
      forecasts: [{ ...forecast, rank: 2, id: 'f2' }, forecast],
    } as unknown as KarhutlaPredictionRun;
    const view = toRunView(run, true);
    expect(view.disclaimer).toMatch(/not calibrated|neither is calibrated/);
    expect(view.modelVersions.smoke).toBe('karhutla-smoke-lagrangian-v0.1');
    expect(view.forecasts!.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(toRunView(run, false)).not.toHaveProperty('forecasts');
  });
});
