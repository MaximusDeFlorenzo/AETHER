import {
  angularDifferenceDeg,
  DirectionScore,
  domainCell,
  ProbabilisticScore,
} from './verification';
import { INDONESIA_RAIN_DOMAIN } from './gsmap';

describe('domainCell', () => {
  it('matches the GSMaP subset geometry', () => {
    expect(domainCell(INDONESIA_RAIN_DOMAIN, 9.95, 90.05)).toEqual({
      line: 0,
      column: 0,
    });
    // Jakarta: GSMaP line 662 / column 1068 → subset line 162 / column 168.
    expect(domainCell(INDONESIA_RAIN_DOMAIN, -6.2, 106.8)).toEqual({
      line: 162,
      column: 168,
    });
    expect(domainCell(INDONESIA_RAIN_DOMAIN, 20, 100)).toBeNull();
  });
});

describe('ProbabilisticScore', () => {
  it('gives a perfect forecast Brier 0 and skill 1', () => {
    const score = new ProbabilisticScore();
    score.add(1, true);
    score.add(0, false);
    score.add(0, false);
    const summary = score.summary();
    expect(summary.brierScore).toBe(0);
    expect(summary.brierSkillScore).toBe(1);
    expect(summary.contingency).toEqual(
      expect.objectContaining({
        hits: 1,
        correctNegatives: 2,
        probabilityOfDetection: 1,
        falseAlarmRatio: 0,
        criticalSuccessIndex: 1,
      }),
    );
  });

  it('gives forecasting the climatology zero skill', () => {
    const score = new ProbabilisticScore();
    for (let i = 0; i < 4; i++) score.add(0.25, i === 0);
    const summary = score.summary();
    expect(summary.observedFrequency).toBe(0.25);
    expect(summary.brierSkillScore).toBe(0);
  });

  it('counts misses and false alarms at p ≥ 0.5 and fills reliability bins', () => {
    const score = new ProbabilisticScore();
    score.add(0.2, true); // miss
    score.add(0.8, false); // false alarm
    score.add(0.6, true); // hit
    const summary = score.summary();
    expect(summary.contingency).toEqual(
      expect.objectContaining({
        hits: 1,
        misses: 1,
        falseAlarms: 1,
        probabilityOfDetection: 0.5,
        falseAlarmRatio: 0.5,
        criticalSuccessIndex: 0.333,
      }),
    );
    const top = summary.reliability.find((b) => b.from === 0.7);
    expect(top).toEqual(
      expect.objectContaining({ n: 1, observedFrequency: 0, to: 1 }),
    );
    expect(summary.reliability.reduce((s, b) => s + b.n, 0)).toBe(3);
  });

  it('puts p = 1 in the last bin', () => {
    const score = new ProbabilisticScore();
    score.add(1, true);
    expect(score.summary().reliability[4].n).toBe(1);
  });

  it('reports nulls with no data and no skill with no observed variance', () => {
    expect(new ProbabilisticScore().summary().brierScore).toBeNull();
    const dry = new ProbabilisticScore();
    dry.add(0, false);
    expect(dry.summary().brierSkillScore).toBeNull();
  });
});

describe('direction scoring', () => {
  it('measures angles the short way round', () => {
    expect(angularDifferenceDeg(350, 10)).toBe(20);
    expect(angularDifferenceDeg(10, 350)).toBe(20);
    expect(angularDifferenceDeg(0, 180)).toBe(180);
    expect(angularDifferenceDeg(90, 90)).toBe(0);
  });

  it('summarizes median error and hit fractions', () => {
    const score = new DirectionScore();
    score.add(0, 10);
    score.add(0, 60);
    score.add(0, 170);
    expect(score.summary()).toEqual({
      n: 3,
      medianAbsErrorDeg: 60,
      within45DegFraction: 0.333,
      within90DegFraction: 0.667,
    });
    expect(new DirectionScore().summary().medianAbsErrorDeg).toBeNull();
  });
});
