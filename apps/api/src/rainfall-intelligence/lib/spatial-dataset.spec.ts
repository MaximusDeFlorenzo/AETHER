import { chronologicalSplit, WeightedRows } from './spatial-dataset';

const HOUR_MS = 3_600_000;
const T0 = new Date('2026-10-01T00:00:00Z');
const hours = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(T0.getTime() + i * HOUR_MS));

describe('chronologicalSplit', () => {
  it('splits 60/20/20 by time and embargoes hours whose labels reach the next split', () => {
    const { splits, boundaries, embargoed } = chronologicalSplit(hours(100), 3);
    expect(boundaries).toEqual([hours(100)[60], hours(100)[80]]);
    // t + 3 h ≥ boundary → dropped: hours 57–59 and 77–79.
    expect(splits.slice(55, 62)).toEqual([0, 0, null, null, null, 1, 1]);
    expect(splits.slice(76, 82)).toEqual([1, null, null, null, 2, 2]);
    expect(embargoed).toBe(6);
    expect(splits[99]).toBe(2);
  });

  it('never puts a later hour in an earlier split', () => {
    const { splits } = chronologicalSplit(hours(50), 1);
    const codes = splits.filter((s): s is 0 | 1 | 2 => s !== null);
    expect([...codes].sort()).toEqual(codes);
  });
});

describe('WeightedRows', () => {
  it('merges identical rows into weights', () => {
    const rows = new WeightedRows();
    rows.add(1, 0, false, [0, 0, 1]);
    rows.add(1, 0, false, [0, 0, 1]);
    rows.add(1, 0, true, [0, 0, 1]);
    rows.add(2, 2, false, [0.5, 0, 1]);
    expect(rows.size).toBe(3);
    expect(rows.total()).toBe(4);
    expect(rows.toRows()).toEqual([
      [1, 0, 0, 2, 0, 0, 1],
      [1, 0, 1, 1, 0, 0, 1],
      [2, 2, 0, 1, 0.5, 0, 1],
    ]);
  });
});
