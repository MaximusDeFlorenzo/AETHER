import { PopulationPeriodStatus } from '../../common/enums/domain.enum';

/**
 * The explicit, NOT NULL identity for "is this the same fact reported
 * again" — required because `UNIQUE(village_id, period_year)` would treat
 * every NULL `period_year` as distinct, silently allowing duplicate
 * "unknown period" rows for the same village (docs/DATABASE_SCHEMA.md
 * §6c). Used identically at preview time (row-vs-row and row-vs-DB
 * comparison) and at confirm time (the actual write), so a row's preview
 * classification (duplicate/unchanged/conflict) can never disagree with
 * what confirm does with it.
 *
 * - Confirmed period: `year:<periodYear>` — one fact per village per year,
 *   regardless of which report date within that year produced it.
 * - Unknown period: `unknown:<reportedDate ?? 'no-date'>:<sourceName>` — two
 *   unknown-period reports for the same village are the same fact only if
 *   they share both a reported date and a source; a different date is a
 *   genuinely different report, not a duplicate.
 */
export function computeDedupeKey(params: {
  periodStatus: PopulationPeriodStatus;
  periodYear: number | null;
  reportedDate: string | null;
  sourceName: string;
}): string {
  if (params.periodStatus === PopulationPeriodStatus.CONFIRMED) {
    return `year:${params.periodYear}`;
  }
  return `unknown:${params.reportedDate ?? 'no-date'}:${params.sourceName}`;
}
