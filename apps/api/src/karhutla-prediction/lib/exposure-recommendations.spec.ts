import { computeExposure, type CandidatePlace } from './exposure';
import { buildRecommendations } from './recommendations';

const fire = { latitude: 0, longitude: 0 };
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

function place(
  id: string,
  lat: number,
  lon: number,
  kind: CandidatePlace['kind'] = 'settlement',
): CandidatePlace {
  return {
    id,
    name: `Place ${id}`,
    kind,
    placeType: kind === 'settlement' ? 'village' : null,
    provinceName: null,
    latitude: lat,
    longitude: lon,
    source: kind === 'settlement' ? 'openstreetmap' : 'aether_districts',
  };
}

const places = [
  place('in-spread', 0.01, -0.01),
  place('core', 0, -0.2),
  place('likely', 0, -0.4),
  place('outside', 1, 1, 'district_reference_point'),
];
const spread = [
  { horizonHours: 1, status: 'ok', envelope: box(-0.02, -0.02, 0.02, 0.02) },
  { horizonHours: 3, status: 'insufficient_data', envelope: null },
];
const smoke = [
  {
    horizonHours: 1,
    status: 'ok',
    footprint: [
      { level: 'core' as const, geometry: box(-0.3, -0.1, 0, 0.1) },
      { level: 'likely' as const, geometry: box(-0.5, -0.1, 0, 0.1) },
      { level: 'possible' as const, geometry: box(-0.6, -0.2, 0.1, 0.2) },
    ],
  },
];

describe('computeExposure', () => {
  const exposure = computeExposure(fire, places, spread, smoke, [1, 3]);

  it('intersects places with the spread envelope only for ok horizons', () => {
    expect(exposure[0].spread.map((p) => p.id)).toEqual(['in-spread']);
    expect(exposure[0].spread[0].distanceFromFireKm).toBeGreaterThan(0);
    expect(exposure[1].spread).toEqual([]); // insufficient_data -> no polygon
  });

  it('assigns each place to its densest smoke class only', () => {
    const { core, likely, possible } = exposure[0].smoke;
    expect(core.map((p) => p.id).sort()).toEqual(['core', 'in-spread']);
    expect(likely.map((p) => p.id)).toEqual(['likely']);
    expect(possible).toEqual([]);
    expect(
      exposure[0].smoke.core.find((p) => p.id === 'outside'),
    ).toBeUndefined();
  });
});

describe('buildRecommendations', () => {
  const exposure = computeExposure(fire, places, spread, smoke, [1, 3]);
  const base = {
    hotspotFreshness: 'fresh' as const,
    hotspotAgeHours: 2,
    confidence: 'low',
    spreadAvailable: true,
    smokeAvailable: true,
    exposure,
    settlementsUnavailable: false,
  };

  it('always asks for ground verification and never orders evacuation', () => {
    const recs = buildRecommendations(base);
    expect(recs[0].code).toBe('VERIFY_ON_GROUND');
    for (const rec of recs) {
      expect(rec.basis.length).toBeGreaterThan(0);
      expect(rec.text).not.toMatch(/\bevacuate now\b|\bmust evacuate\b/i);
    }
    expect(recs.find((r) => r.code === 'SPREAD_REACHES_PLACES')?.text).toMatch(
      /Do not order evacuations/,
    );
  });

  it('issues smoke health advice for core/likely places', () => {
    const smokeRec = buildRecommendations(base).find(
      (r) => r.code === 'SMOKE_MAY_REACH_PLACES',
    );
    expect(smokeRec?.audience).toBe('public');
    expect(smokeRec?.text).toMatch(/Place core/);
    expect(smokeRec?.text).toMatch(/N95/);
  });

  it('flags stale observations, degraded inputs and missing settlement data', () => {
    const codes = buildRecommendations({
      ...base,
      hotspotFreshness: 'aging',
      hotspotAgeHours: 14,
      confidence: 'very_low',
      settlementsUnavailable: true,
    }).map((r) => r.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'REFRESH_OBSERVATION',
        'DEGRADED_INPUTS',
        'SETTLEMENT_DATA_MISSING',
      ]),
    );
  });

  it('says "no known places" honestly when nothing intersects', () => {
    const none = computeExposure(
      fire,
      [place('far', 5, 5)],
      spread,
      smoke,
      [1],
    );
    const recs = buildRecommendations({ ...base, exposure: none });
    expect(
      recs.find((r) => r.code === 'NO_KNOWN_PLACES_EXPOSED')?.text,
    ).toMatch(/does not mean no one is exposed/);
  });
});
