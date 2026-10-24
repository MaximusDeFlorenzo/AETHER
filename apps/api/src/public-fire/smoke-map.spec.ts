import type { SmokeHorizonResult } from '../karhutla-prediction/karhutla.types';
import {
  matchCluster,
  pickHorizon,
  smokeReach,
  toPublicSmokeForecast,
  type ForecastInput,
} from './smoke-map';

const square = (lng: number, lat: number, half: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [lng - half, lat - half],
      [lng + half, lat - half],
      [lng + half, lat + half],
      [lng - half, lat + half],
      [lng - half, lat - half],
    ],
  ],
});

function horizon(
  horizonHours: number,
  validAt: string,
  centreLng: number,
  status: SmokeHorizonResult['status'] = 'ok',
): SmokeHorizonResult {
  return {
    horizonHours,
    validAt,
    status,
    particlesAirborne: 800,
    footprint: [
      {
        level: 'core',
        particleShare: 0.5,
        geometry: square(centreLng, -2, 0.05),
        areaKm2: 120,
      },
      {
        level: 'likely',
        particleShare: 0.8,
        geometry: square(centreLng, -2, 0.15),
        areaKm2: 900,
      },
      {
        level: 'possible',
        particleShare: 1,
        geometry: square(centreLng, -2, 0.3),
        areaKm2: 3600,
      },
    ],
    cellSizeKm: 3,
    centroid: null,
    transportBearingDeg: 270,
    p90DistanceKm: 40,
    shareAboveBoundaryLayer: 0,
  } as SmokeHorizonResult;
}

// Run issued 09:00; smoke drifts west 0.2° per step.
const horizons = [
  horizon(1, '2026-10-23T10:00:00Z', 114.0),
  horizon(3, '2026-10-23T12:00:00Z', 113.8),
  horizon(6, '2026-10-23T15:00:00Z', 113.6),
  horizon(12, '2026-10-23T21:00:00Z', 113.4, 'insufficient_data'),
];
const now = new Date('2026-10-23T11:30:00Z');

describe('pickHorizon', () => {
  it('picks the horizon valid closest to the display time', () => {
    expect(
      pickHorizon(horizons, new Date('2026-10-23T12:30:00Z'))?.horizonHours,
    ).toBe(3);
    expect(
      pickHorizon(horizons, new Date('2026-10-23T17:30:00Z'))?.horizonHours,
    ).toBe(6);
  });

  it('shows nothing when no horizon is within 3 h of it', () => {
    expect(
      pickHorizon(horizons.slice(0, 3), new Date('2026-10-23T23:30:00Z')),
    ).toBeNull();
  });
});

describe('smokeReach', () => {
  it('reports the earliest future horizon covering the citizen, densest level first', () => {
    expect(smokeReach(horizons, -2, 113.8, now)).toEqual({
      horizonHours: 3,
      validAt: '2026-10-23T12:00:00Z',
      hoursFromNow: 1,
      level: 'core',
    });
    expect(smokeReach(horizons, -2, 113.47, now)).toMatchObject({
      horizonHours: 6,
      level: 'likely',
    });
  });

  it('ignores horizons that are already history', () => {
    // Only the 10:00 horizon (1.5 h ago) covered 114.25.
    expect(smokeReach(horizons, -2, 114.25, now)).toBeNull();
  });
});

describe('matchCluster', () => {
  const forecast = {
    latitude: -2,
    longitude: 114,
    hotspotEventIds: ['a', 'b', 'c'],
  } as ForecastInput;

  it('prefers the cluster sharing the most hotspots', () => {
    expect(
      matchCluster(forecast, [
        { id: 'near', latitude: -2, longitude: 114, hotspotEventIds: ['a'] },
        {
          id: 'shared',
          latitude: -2.05,
          longitude: 114.05,
          hotspotEventIds: ['b', 'c'],
        },
      ]),
    ).toBe('shared');
  });

  it('falls back to the nearest cluster within 10 km', () => {
    expect(
      matchCluster(forecast, [
        { id: 'x', latitude: -2.05, longitude: 114, hotspotEventIds: ['z'] },
      ]),
    ).toBe('x');
    expect(
      matchCluster(forecast, [
        { id: 'far', latitude: -2.5, longitude: 114, hotspotEventIds: ['z'] },
      ]),
    ).toBeNull();
  });
});

describe('toPublicSmokeForecast', () => {
  it('drops non-ok horizons and geometry-less levels', () => {
    const view = toPublicSmokeForecast(
      {
        id: 'f1',
        rank: 1,
        latitude: -2,
        longitude: 114,
        nearestDistrictName: 'Kabupaten Pulang Pisau',
        confidence: 'medium',
        latestObservedAt: new Date('2026-10-23T06:00:00Z'),
        hotspotEventIds: [],
        dataQuality: { hotspotFreshness: 'aging' },
        smoke: { horizons },
      },
      [],
      now,
      new Date('2026-10-23T23:30:00Z'),
    );
    expect(view.horizon).toBeNull();
    expect(view.reach).toBeNull();
    expect(view.hotspotFreshness).toBe('aging');
  });
});
