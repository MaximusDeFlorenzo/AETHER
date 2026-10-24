import type { GridDomain } from './gsmap';

/**
 * Pure verification metrics for the nowcast backtest. Probabilistic
 * forecasts get a Brier score (and skill against the sample climatology)
 * plus a reliability table — accuracy alone is meaningless when most
 * district-hours are dry. A contingency table at p ≥ 0.5 gives POD / FAR /
 * CSI. Direction forecasts are scored by angular error against the motion
 * that actually happened.
 */

export const RELIABILITY_BIN_EDGES = [0, 0.1, 0.3, 0.5, 0.7, 1.0000001];
export const DECISION_PROBABILITY = 0.5;

/** (line, column) of the cell containing a point, or null outside. */
export function domainCell(
  domain: GridDomain,
  latitude: number,
  longitude: number,
): { line: number; column: number } | null {
  const half = domain.resolutionDeg / 2;
  const line = Math.floor(
    (domain.northLat + half - latitude) / domain.resolutionDeg + 1e-9,
  );
  const column = Math.floor(
    (longitude - (domain.westLon - half)) / domain.resolutionDeg + 1e-9,
  );
  if (line < 0 || line >= domain.ny || column < 0 || column >= domain.nx) {
    return null;
  }
  return { line, column };
}

export class ProbabilisticScore {
  private n = 0;
  private brierSum = 0;
  private observedSum = 0;
  private probabilitySum = 0;
  private hits = 0;
  private misses = 0;
  private falseAlarms = 0;
  private correctNegatives = 0;
  private readonly bins = RELIABILITY_BIN_EDGES.slice(0, -1).map(() => ({
    n: 0,
    probabilitySum: 0,
    observedSum: 0,
  }));

  add(probability: number, observed: boolean): void {
    const o = observed ? 1 : 0;
    this.n += 1;
    this.brierSum += (probability - o) ** 2;
    this.observedSum += o;
    this.probabilitySum += probability;
    const yes = probability >= DECISION_PROBABILITY;
    if (yes && observed) this.hits += 1;
    else if (!yes && observed) this.misses += 1;
    else if (yes && !observed) this.falseAlarms += 1;
    else this.correctNegatives += 1;
    const bin = RELIABILITY_BIN_EDGES.findIndex(
      (edge, i) =>
        probability >= edge && probability < RELIABILITY_BIN_EDGES[i + 1],
    );
    if (bin >= 0 && bin < this.bins.length) {
      this.bins[bin].n += 1;
      this.bins[bin].probabilitySum += probability;
      this.bins[bin].observedSum += o;
    }
  }

  summary() {
    const ratio = (a: number, b: number) => (b > 0 ? round(a / b) : null);
    const observedFrequency = this.n ? this.observedSum / this.n : null;
    const brier = this.n ? this.brierSum / this.n : null;
    // Reference: always forecasting the sample climatology.
    const climatologyBrier =
      observedFrequency === null
        ? null
        : observedFrequency * (1 - observedFrequency);
    return {
      n: this.n,
      observedFrequency:
        observedFrequency === null ? null : round(observedFrequency),
      meanProbability: this.n ? round(this.probabilitySum / this.n) : null,
      brierScore: brier === null ? null : round(brier),
      brierSkillScore:
        brier === null || !climatologyBrier
          ? null
          : round(1 - brier / climatologyBrier),
      contingency: {
        threshold: DECISION_PROBABILITY,
        hits: this.hits,
        misses: this.misses,
        falseAlarms: this.falseAlarms,
        correctNegatives: this.correctNegatives,
        probabilityOfDetection: ratio(this.hits, this.hits + this.misses),
        falseAlarmRatio: ratio(this.falseAlarms, this.hits + this.falseAlarms),
        criticalSuccessIndex: ratio(
          this.hits,
          this.hits + this.misses + this.falseAlarms,
        ),
      },
      reliability: this.bins.map((bin, i) => ({
        from: RELIABILITY_BIN_EDGES[i],
        to: Math.min(1, RELIABILITY_BIN_EDGES[i + 1]),
        n: bin.n,
        meanProbability: ratio(bin.probabilitySum, bin.n),
        observedFrequency: ratio(bin.observedSum, bin.n),
      })),
    };
  }
}

/** Smallest absolute difference between two directions, 0–180°. */
export function angularDifferenceDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export class DirectionScore {
  private readonly errors: number[] = [];

  add(predictedTowardDeg: number, realizedTowardDeg: number): void {
    this.errors.push(
      angularDifferenceDeg(predictedTowardDeg, realizedTowardDeg),
    );
  }

  summary() {
    const sorted = [...this.errors].sort((a, b) => a - b);
    const n = sorted.length;
    const median =
      n === 0
        ? null
        : n % 2
          ? sorted[(n - 1) / 2]
          : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return {
      n,
      medianAbsErrorDeg: median === null ? null : round(median),
      within45DegFraction: n
        ? round(sorted.filter((e) => e <= 45).length / n)
        : null,
      // A direction picked at random would score 0.25 here.
      within90DegFraction: n
        ? round(sorted.filter((e) => e <= 90).length / n)
        : null,
    };
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
