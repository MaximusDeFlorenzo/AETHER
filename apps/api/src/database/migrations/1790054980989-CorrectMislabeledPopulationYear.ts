import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Targeted data correction, NOT a historical-assessment recompute and NOT a
 * blanket wipe of year=2025 data.
 *
 * Context: the original `reference-data.seed.ts` stored the Kemendagri/
 * Dukcapil population count (actually as-of Semester II/December 2024) as
 * `year=2025` (the decree's publication year) with a generic `source =
 * 'Kemendagri'`. This was fixed in the seed going forward
 * (`POPULATION_YEAR = 2024`, precise `source` label), but any
 * `population_statistics` row already written by the old seed code keeps
 * the wrong `year`/`source` until corrected here — and
 * `GeoService.getLatestPopulation()`'s `ORDER BY year DESC` would keep
 * preferring the stale, mislabeled 2025 row over a correct 2024 row.
 *
 * This migration touches ONLY rows matching the OLD buggy signature exactly
 * (`year = 2025 AND source = 'Kemendagri'`) — never any row a user may have
 * added or edited with a different `source` value, and never
 * `risk_assessments.input_snapshot` or any other historical record (those
 * stay exactly as they were computed; this is a reference-data correction,
 * not a reprocessing of past assessments).
 *
 * Two cases, handled separately because of the `(district, year)` unique
 * constraint:
 *   1. No 2024 row yet for that district: UPDATE the existing row in place
 *      (same id) to year=2024 with the precise source label — preserves the
 *      row's identity, just fixes its metadata.
 *   2. A 2024 row already exists for that district (e.g. the corrected seed
 *      was re-run before this migration, inserting a fresh correct 2024 row
 *      alongside the stale 2025 one): DELETE the now-redundant 2025 row —
 *      the 2024 row it duplicates already carries the correct data. This is
 *      a narrowly-targeted deletion of confirmed-redundant rows, not "all
 *      2025 data".
 *
 * Traceability: this migration file (tracked in the `migrations` table by
 * name/timestamp, and in this repo's git history) is the record of the
 * correction — the corrected rows become byte-identical to what a fresh
 * seed run produces, which is the intended end state, not a special
 * "corrected" marker that would need its own column.
 */
export class CorrectMislabeledPopulationYear1790054980989 implements MigrationInterface {
  name = 'CorrectMislabeledPopulationYear1790054980989';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const OLD_YEAR = 2025;
    const OLD_SOURCE = 'Kemendagri';
    const CORRECT_YEAR = 2024;
    const CORRECT_SOURCE =
      'Kemendagri (Ditjen Dukcapil) - Semester II Des 2024';

    const redundant: Array<{ count: string }> = await queryRunner.query(
      `
      SELECT count(*) FROM population_statistics ps2025
      JOIN population_statistics ps2024
        ON ps2024.district_id = ps2025.district_id AND ps2024.year = $1
      WHERE ps2025.year = $2 AND ps2025.source = $3
      `,
      [CORRECT_YEAR, OLD_YEAR, OLD_SOURCE],
    );

    await queryRunner.query(
      `
      DELETE FROM population_statistics ps2025
      USING population_statistics ps2024
      WHERE ps2025.year = $1 AND ps2025.source = $2
        AND ps2024.year = $3
        AND ps2024.district_id = ps2025.district_id
      `,
      [OLD_YEAR, OLD_SOURCE, CORRECT_YEAR],
    );

    const corrected: Array<{ count: string }> = await queryRunner.query(
      `
      SELECT count(*) FROM population_statistics
      WHERE year = $1 AND source = $2
      `,
      [OLD_YEAR, OLD_SOURCE],
    );

    await queryRunner.query(
      `
      UPDATE population_statistics
      SET year = $1, source = $2
      WHERE year = $3 AND source = $4
      `,
      [CORRECT_YEAR, CORRECT_SOURCE, OLD_YEAR, OLD_SOURCE],
    );

    console.log(
      `CorrectMislabeledPopulationYear: deleted ${redundant[0]?.count ?? 0} ` +
        `redundant year=2025 rows (a correct 2024 row already existed), ` +
        `corrected ${corrected[0]?.count ?? 0} year=2025 rows in place to year=2024.`,
    );
  }

  public async down(): Promise<void> {
    // Not reversible: the deleted rows (case 2) were confirmed-redundant
    // duplicates of a correct 2024 row with no unique information lost, and
    // the in-place-corrected rows (case 1) are now indistinguishable from a
    // row a fresh seed run would produce — which is the intended, correct
    // end state, not a special migration-only state to roll back from.
  }
}
