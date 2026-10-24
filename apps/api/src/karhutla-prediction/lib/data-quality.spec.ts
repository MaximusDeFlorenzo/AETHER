import { assessDataQuality, classifyHotspotAge } from './data-quality';

const issuedAt = new Date('2026-09-20T06:00:00Z');
const hours = (from: number, to: number) =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => new Date(issuedAt.getTime() + (from + i) * 3_600_000),
  );

function base() {
  return {
    issuedAt,
    latestHotspotAt: new Date(issuedAt.getTime() - 2 * 3_600_000),
    weatherRetrievedAt: new Date(issuedAt.getTime() - 5 * 60_000),
    surfaceWeatherTimes: hours(-24, 13),
    atmosphereGridPoints: 25,
    atmosphereGridPointsRequested: 25,
    terrainAvailable: true,
    maxHorizonHours: 6,
  };
}

describe('assessDataQuality', () => {
  it('reports clean inputs with no issues', () => {
    const q = assessDataQuality(base());
    expect(q.hotspotFreshness).toBe('fresh');
    expect(q.weatherCoverage.coversObservationToMaxHorizon).toBe(true);
    expect(q.issues).toEqual([]);
  });

  it('classifies hotspot age', () => {
    expect(classifyHotspotAge(3)).toBe('fresh');
    expect(classifyHotspotAge(13)).toBe('aging');
    expect(classifyHotspotAge(25)).toBe('stale');
  });

  it('flags stale weather, missing coverage, partial grids and missing terrain', () => {
    const q = assessDataQuality({
      ...base(),
      weatherRetrievedAt: new Date(issuedAt.getTime() - 3 * 3_600_000),
      surfaceWeatherTimes: hours(-1, 2),
      atmosphereGridPoints: 20,
      terrainAvailable: false,
    });
    expect(q.weatherAgeMinutes).toBe(180);
    expect(q.weatherCoverage.coversObservationToMaxHorizon).toBe(false);
    expect(q.atmosphereGridCoverage).toBe(0.8);
    expect(q.issues).toHaveLength(4);
  });

  it('flags missing weather entirely', () => {
    const q = assessDataQuality({
      ...base(),
      weatherRetrievedAt: null,
      surfaceWeatherTimes: [],
    });
    expect(q.weatherAgeMinutes).toBeNull();
    expect(q.issues.join(' ')).toMatch(/No surface weather/);
  });
});
