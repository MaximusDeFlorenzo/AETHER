import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds manual-resolution support for `village_population_import_rows`
 * stuck at HIERARCHY_MISMATCH / REGION_NOT_FOUND / NEEDS_REVIEW — an
 * admin/analyst accepts or rejects the row via
 * `VillagePopulationImportService.resolveRow` (see
 * `PopulationImportRowResolutionAction`'s comment in domain.enum.ts).
 *
 * `candidate_village_ids` separately backfills a pre-existing gap: the
 * validator always computed 0/N candidate villages for a NEEDS_REVIEW row
 * (row-processor.ts's hierarchy-fallback path) but never persisted them —
 * the count appeared in the row's message text, but the actual candidate
 * ids were discarded after validation, forcing a reviewer to redo the
 * same hierarchy search by hand. Only rows validated AFTER this migration
 * (and the matching ValidationProcessor change) will have this populated;
 * existing NEEDS_REVIEW rows from before stay NULL, same as any other
 * historical row this feature didn't exist for yet.
 */
export class AddImportRowManualResolution1791065452596 implements MigrationInterface {
  name = 'AddImportRowManualResolution1791065452596';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "population_import_row_resolution_action" AS ENUM (
        'accepted', 'rejected'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_rows"
      ADD COLUMN "candidate_village_ids" JSONB,
      ADD COLUMN "resolution_action" "population_import_row_resolution_action",
      ADD COLUMN "resolution_note" TEXT,
      ADD COLUMN "resolved_by_user_id" UUID REFERENCES "users"("id"),
      ADD COLUMN "resolved_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "village_population_import_rows"
      DROP COLUMN "candidate_village_ids",
      DROP COLUMN "resolution_action",
      DROP COLUMN "resolution_note",
      DROP COLUMN "resolved_by_user_id",
      DROP COLUMN "resolved_at"
    `);
    await queryRunner.query(
      `DROP TYPE "population_import_row_resolution_action"`,
    );
  }
}
