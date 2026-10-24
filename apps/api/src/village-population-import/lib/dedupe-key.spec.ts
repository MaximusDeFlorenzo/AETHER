import { PopulationPeriodStatus } from '../../common/enums/domain.enum';
import { computeDedupeKey } from './dedupe-key';

describe('computeDedupeKey', () => {
  it('confirmed period ignores reportedDate/sourceName entirely (one fact per village per year)', () => {
    const a = computeDedupeKey({
      periodStatus: PopulationPeriodStatus.CONFIRMED,
      periodYear: 2024,
      reportedDate: '2024-01-01',
      sourceName: 'Source A',
    });
    const b = computeDedupeKey({
      periodStatus: PopulationPeriodStatus.CONFIRMED,
      periodYear: 2024,
      reportedDate: '2024-12-31',
      sourceName: 'Source B',
    });
    expect(a).toBe(b);
    expect(a).toBe('year:2024');
  });

  it('unknown period keys by reportedDate + sourceName, never just village', () => {
    expect(
      computeDedupeKey({
        periodStatus: PopulationPeriodStatus.UNKNOWN,
        periodYear: null,
        reportedDate: '2014-06-17',
        sourceName: 'Prodeskel',
      }),
    ).toBe('unknown:2014-06-17:Prodeskel');
  });

  it('unknown period with no reported date falls back to a stable "no-date" marker, not null/undefined leaking into the key', () => {
    expect(
      computeDedupeKey({
        periodStatus: PopulationPeriodStatus.UNKNOWN,
        periodYear: null,
        reportedDate: null,
        sourceName: 'Prodeskel',
      }),
    ).toBe('unknown:no-date:Prodeskel');
  });

  it('different confirmed years never collide', () => {
    const y2023 = computeDedupeKey({
      periodStatus: PopulationPeriodStatus.CONFIRMED,
      periodYear: 2023,
      reportedDate: null,
      sourceName: 'X',
    });
    const y2024 = computeDedupeKey({
      periodStatus: PopulationPeriodStatus.CONFIRMED,
      periodYear: 2024,
      reportedDate: null,
      sourceName: 'X',
    });
    expect(y2023).not.toBe(y2024);
  });
});
