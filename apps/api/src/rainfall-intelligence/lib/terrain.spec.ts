import {
  metresPerDegree,
  slopeQuantileDeg,
  stencilSlopeDeg,
  summarizeTerrain,
  terrainSites,
} from './terrain';

const OFFSET = 1 / 1200;

describe('terrainSites', () => {
  it('spreads a grid over the footprint with a N/S/E/W stencil', () => {
    const sites = terrainSites(-7, 110, 4, 0.05, OFFSET);
    expect(sites).toHaveLength(16);
    expect(sites[0].latitude).toBeCloseTo(-7.05);
    expect(sites[0].longitude).toBeCloseTo(109.95);
    expect(sites[15].latitude).toBeCloseTo(-6.95);
    expect(sites[15].longitude).toBeCloseTo(110.05);
    const [n, s, e, w] = sites[0].stencil;
    expect(n.latitude - sites[0].latitude).toBeCloseTo(OFFSET);
    expect(s.latitude - sites[0].latitude).toBeCloseTo(-OFFSET);
    expect(e.longitude - sites[0].longitude).toBeCloseTo(OFFSET);
    expect(w.longitude - sites[0].longitude).toBeCloseTo(-OFFSET);
  });

  it('a 1 × 1 grid is the point itself', () => {
    expect(terrainSites(-7, 110, 1, 0.05, OFFSET)[0]).toEqual(
      expect.objectContaining({ latitude: -7, longitude: 110 }),
    );
  });
});

describe('stencilSlopeDeg', () => {
  it('is zero on flat ground', () => {
    expect(stencilSlopeDeg(-7, OFFSET, [100, 100, 100, 100])).toBe(0);
  });

  it('recovers a 45° slope', () => {
    const m = metresPerDegree(-7);
    const rise = 2 * OFFSET * m.lat; // over the N–S baseline
    expect(stencilSlopeDeg(-7, OFFSET, [rise, 0, 50, 50])).toBeCloseTo(45, 5);
  });

  it('uses the shorter E–W metres per degree away from the equator', () => {
    const m = metresPerDegree(-7);
    expect(m.lon).toBeLessThan(m.lat);
    // Between the tabulated 110,574 m (0°) and 110,649 m (15°).
    expect(m.lat).toBeCloseTo(110_591, 0);
  });
});

describe('summarizeTerrain', () => {
  const sites = terrainSites(-7, 110, 2, 0.05, OFFSET); // 4 sites

  it('summarises land sites and drops sea/failed ones', () => {
    const z = [
      ...[200, 100, 150, 150], // steep N–S
      ...[0, 0, 0, 0], // sea
      ...[300, 300, 300, 300], // flat
      ...[50, null, 50, 50], // failed lookup
    ];
    const summary = summarizeTerrain(sites, z, OFFSET);
    expect(summary.samplesPlanned).toBe(4);
    expect(summary.samplesValid).toBe(2);
    expect(summary.slopeSamplesDeg[1]).toBe(0);
    expect(summary.slopeSamplesDeg[0]).toBeGreaterThan(15);
    expect(summary.slopeMaxDeg).toBe(summary.slopeSamplesDeg[0]);
    expect(summary.elevationMinM).toBe(150);
    expect(summary.elevationMaxM).toBe(300);
    expect(summary.elevationMeanM).toBe(225);
  });

  it('is empty when every site is sea', () => {
    expect(summarizeTerrain(sites, new Array(16).fill(0), OFFSET)).toEqual(
      expect.objectContaining({
        slopeSamplesDeg: [],
        slopeMedianDeg: null,
        samplesValid: 0,
      }),
    );
  });
});

describe('slopeQuantileDeg', () => {
  it('interpolates like numpy and lets hills around a valley count', () => {
    expect(slopeQuantileDeg([0, 10], 0.5)).toBe(5);
    expect(slopeQuantileDeg([...new Array(13).fill(1), 30, 30, 30], 0.9)).toBe(
      30,
    );
    expect(slopeQuantileDeg([], 0.9)).toBeNull();
  });
});
