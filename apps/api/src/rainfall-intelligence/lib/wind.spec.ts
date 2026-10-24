import {
  compassPoint,
  encodeDirection,
  normalizeDirectionDeg,
  towardDeg,
  uvToWind,
  vectorMeanWind,
  windToUv,
} from './wind';

describe('wind direction normalization', () => {
  it('maps any angle into [0, 360)', () => {
    expect(normalizeDirectionDeg(360)).toBe(0);
    expect(normalizeDirectionDeg(-90)).toBe(270);
    expect(normalizeDirectionDeg(725)).toBe(5);
    expect(normalizeDirectionDeg(-0)).toBe(0);
    expect(normalizeDirectionDeg(NaN)).toBeNull();
  });

  it('gives the direction the air moves toward', () => {
    expect(towardDeg(90)).toBe(270);
    expect(towardDeg(200)).toBe(20);
  });

  it('uses meteorological u/v: a wind FROM the north moves southward', () => {
    const { u, v } = windToUv(10, 0);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(-10);
    const east = windToUv(10, 90);
    expect(east.u).toBeCloseTo(-10);
  });

  it('round-trips u/v back to speed and from-direction', () => {
    for (const from of [0, 45, 135, 225, 359]) {
      const { u, v } = windToUv(12, from);
      const back = uvToWind(u, v);
      expect(back.speedKmh).toBeCloseTo(12);
      expect(back.fromDeg).toBeCloseTo(from === 0 ? 0 : from);
    }
    expect(uvToWind(0, 0)).toEqual({ speedKmh: 0, fromDeg: null });
  });

  it('encodes 359° and 1° as near neighbours, not opposite ends', () => {
    const a = encodeDirection(359);
    const b = encodeDirection(1);
    const distance = Math.hypot(a.sin - b.sin, a.cos - b.cos);
    expect(distance).toBeLessThan(0.05);
  });

  it('names compass points with wrap-around', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(350)).toBe('N');
    expect(compassPoint(45)).toBe('NE');
    expect(compassPoint(200)).toBe('SSW');
  });
});

describe('vectorMeanWind', () => {
  it('averages across the 0°/360° seam instead of to 180°', () => {
    const mean = vectorMeanWind([
      { speedKmh: 10, fromDeg: 350 },
      { speedKmh: 10, fromDeg: 10 },
    ]);
    expect(mean?.fromDeg).toBeCloseTo(0);
    expect(mean?.steadiness).toBeGreaterThan(0.95);
  });

  it('reports low steadiness when directions cancel out', () => {
    const mean = vectorMeanWind([
      { speedKmh: 10, fromDeg: 90 },
      { speedKmh: 10, fromDeg: 270 },
    ]);
    expect(mean?.steadiness).toBeCloseTo(0);
    expect(mean?.fromDeg).toBeNull();
  });

  it('returns null without readings', () => {
    expect(vectorMeanWind([])).toBeNull();
  });
});
