import { GroundObservationType } from '../ground-report.enums';
import {
  findDuplicateOf,
  isWithinIndonesia,
  observedAtProblem,
} from './report-rules';

describe('isWithinIndonesia', () => {
  it('accepts Jakarta, Sabang and Merauke', () => {
    expect(isWithinIndonesia(-6.2, 106.8)).toBe(true);
    expect(isWithinIndonesia(5.89, 95.32)).toBe(true);
    expect(isWithinIndonesia(-8.49, 140.4)).toBe(true);
  });

  it('rejects swapped and out-of-region coordinates', () => {
    expect(isWithinIndonesia(106.8, -6.2)).toBe(false);
    expect(isWithinIndonesia(0, 0)).toBe(false);
    expect(isWithinIndonesia(1.35, 90)).toBe(false);
  });
});

describe('observedAtProblem', () => {
  const now = new Date('2026-10-13T08:00:00Z');

  it('allows recent observations and small clock skew', () => {
    expect(observedAtProblem(new Date('2026-10-13T07:30:00Z'), now)).toBeNull();
    expect(observedAtProblem(new Date('2026-10-13T08:05:00Z'), now)).toBeNull();
  });

  it('flags future, stale and invalid timestamps', () => {
    expect(observedAtProblem(new Date('2026-10-13T09:00:00Z'), now)).toBe(
      'in_future',
    );
    expect(observedAtProblem(new Date('2026-09-01T00:00:00Z'), now)).toBe(
      'too_old',
    );
    expect(observedAtProblem(new Date('not a date'), now)).toBe('invalid');
  });
});

describe('findDuplicateOf', () => {
  const now = new Date('2026-10-13T08:00:00Z');
  const report = {
    observationType: GroundObservationType.FLOODWATER,
    latitude: -6.2,
    longitude: 106.8,
    submittedAt: now,
  };
  const candidate = (
    over: Partial<Parameters<typeof findDuplicateOf>[1][0]>,
  ) => ({
    id: 'r1',
    observationType: GroundObservationType.FLOODWATER,
    latitude: -6.2,
    longitude: 106.8,
    submittedAt: new Date('2026-10-13T07:50:00Z'),
    ...over,
  });

  it('matches the earliest resend of the same observation', () => {
    expect(
      findDuplicateOf(report, [
        candidate({
          id: 'later',
          submittedAt: new Date('2026-10-13T07:55:00Z'),
        }),
        candidate({ id: 'earliest', latitude: -6.2002 }),
      ]),
    ).toBe('earliest');
  });

  it('does not match a different type, a distant point or an old report', () => {
    expect(
      findDuplicateOf(report, [
        candidate({ observationType: GroundObservationType.SMOKE }),
        candidate({ latitude: -6.21 }),
        candidate({ submittedAt: new Date('2026-10-13T07:00:00Z') }),
      ]),
    ).toBeNull();
  });
});
