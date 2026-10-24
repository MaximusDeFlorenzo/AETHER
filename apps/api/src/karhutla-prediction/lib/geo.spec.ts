import {
  destinationPoint,
  haversineKm,
  isValidCoordinate,
  pointInGeometry,
  snappedGrid,
} from './geo';

describe('geo helpers', () => {
  it('validates coordinates', () => {
    expect(isValidCoordinate(-2.2, 113.9)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
    expect(isValidCoordinate('1', 0)).toBe(false);
  });

  it('destinationPoint and haversine agree', () => {
    const p = destinationPoint(-2.2, 113.9, 90, 10);
    expect(haversineKm(-2.2, 113.9, p.latitude, p.longitude)).toBeCloseTo(
      10,
      3,
    );
  });

  it('snaps grids so nearby clusters share points', () => {
    const a = snappedGrid(-2.21, 113.88, 1.5, 0.75);
    const b = snappedGrid(-2.18, 113.93, 1.5, 0.75);
    expect(a).toHaveLength(25);
    expect(a).toEqual(b);
  });

  it('point-in-polygon handles holes and multipolygons', () => {
    const square = (x: number, y: number, s: number) => [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ];
    const donut = {
      type: 'Polygon' as const,
      coordinates: [square(0, 0, 10), square(4, 4, 2)],
    };
    expect(pointInGeometry(1, 1, donut)).toBe(true);
    expect(pointInGeometry(5, 5, donut)).toBe(false); // in the hole
    const multi = {
      type: 'MultiPolygon' as const,
      coordinates: [[square(0, 0, 1)], [square(5, 5, 1)]],
    };
    expect(pointInGeometry(5.5, 5.5, multi)).toBe(true);
    expect(pointInGeometry(3, 3, multi)).toBe(false);
    expect(pointInGeometry(0.5, 0.5, null)).toBe(false);
  });
});
