/**
 * Dataset assembly for the Stage-2 spatial nowcast model
 * (docs/RAINFALL_INTELLIGENCE.md, Milestone 5). Pure functions; the
 * engine-replay side is RainfallSpatialModelService.
 */

const HOUR_MS = 60 * 60 * 1000;

export type SplitCode = 0 | 1 | 2; // train | validation | test

export interface ChronologicalSplit {
  /** Same order as the input; null = embargoed (dropped). */
  splits: Array<SplitCode | null>;
  /** First start hour of validation and of test. */
  boundaries: [Date, Date];
  embargoed: number;
}

/**
 * Splits ascending start hours 60 / 20 / 20 by time (never at random:
 * neighbouring hours share weather). A start whose label time t + maxHorizon
 * reaches into the next split is embargoed, so no training label lies
 * inside the period the model is validated or tested on.
 */
export function chronologicalSplit(
  starts: Date[],
  maxHorizonHours: number,
  fractions: [number, number] = [0.6, 0.8],
): ChronologicalSplit {
  const n = starts.length;
  const b1 = starts[Math.min(n - 1, Math.floor(n * fractions[0]))];
  const b2 = starts[Math.min(n - 1, Math.floor(n * fractions[1]))];
  const reach = maxHorizonHours * HOUR_MS;
  let embargoed = 0;
  const splits = starts.map((start) => {
    const t = start.getTime();
    const code: SplitCode = t < b1.getTime() ? 0 : t < b2.getTime() ? 1 : 2;
    const next = code === 0 ? b1 : code === 1 ? b2 : null;
    if (next && t + reach >= next.getTime()) {
      embargoed += 1;
      return null;
    }
    return code;
  });
  return { splits, boundaries: [b1, b2], embargoed };
}

/**
 * Merges identical (horizon, split, label, features) rows into one row
 * with a weight — most district-hours are dry and identical, so this keeps
 * the training payload small without changing the fit.
 */
export class WeightedRows {
  private readonly counts = new Map<string, number>();

  add(
    horizon: number,
    split: SplitCode,
    label: boolean,
    features: number[],
  ): void {
    const key = `${horizon}|${split}|${label ? 1 : 0}|${features.join(',')}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  get size(): number {
    return this.counts.size;
  }

  /** [horizon, splitCode, label, weight, ...features] */
  toRows(): number[][] {
    return [...this.counts.entries()].map(([key, weight]) => {
      const [horizon, split, label, features] = key.split('|');
      return [
        Number(horizon),
        Number(split),
        Number(label),
        weight,
        ...features.split(',').map(Number),
      ];
    });
  }

  /** Total rows before merging. */
  total(): number {
    let sum = 0;
    for (const count of this.counts.values()) sum += count;
    return sum;
  }
}
