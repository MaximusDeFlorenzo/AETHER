import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Upgrades village-population-import from synchronous request/response
 * processing to a background-job lifecycle (BullMQ), needed to handle
 * ~100k-row files without HTTP timeouts. See
 * village-population-import.service.ts's top comment and docs/DATABASE_SCHEMA.md
 * §6c-6e for the full design.
 *
 * Enum change (`population_import_batch_status`): replaces the old 5-value
 * set (processing/previewed/failed/importing/completed) with an 8-value
 * lifecycle (uploaded/validating/ready/queued/importing/completed/
 * completed_with_errors/failed). Done via create-new-type + migrate-column
 * + drop-old-type (not `ALTER TYPE ... ADD VALUE`, which can't rename
 * existing values and has same-transaction-usage restrictions on older
 * Postgres) — existing rows are remapped: processing->validating,
 * previewed->ready, everything else keeps its name.
 *
 * New columns support: job identity (`validation_job_id`/`import_job_id`),
 * resumable checkpointing after a worker crash (`last_validated_row_number`/
 * `last_imported_row_number`), honest progress reporting without a
 * fabricated percentage (`processed_rows`), and phase timestamps.
 * `previewed_at` is renamed to `ready_at` (same moment, new name matching
 * the new "ready" status).
 *
 * `UNIQUE(batch_id, row_number)` on `village_population_import_rows` backs
 * the validation worker's `INSERT ... ON CONFLICT (batch_id, row_number) DO
 * NOTHING` on each chunk — a defensive backstop against a theoretical
 * doubly-delivered BullMQ job, not the primary resume mechanism (that's the
 * checkpoint column being written in the same transaction as the insert —
 * see ValidationProcessor.persistChunk).
 */
export class AddVillagePopulationImportJobLifecycle1790131824040
  implements MigrationInterface
{
  name = 'AddVillagePopulationImportJobLifecycle1790131824040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "population_import_batch_status_new" AS ENUM (
        'uploaded', 'validating', 'ready', 'queued', 'importing',
        'completed', 'completed_with_errors', 'failed'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches" ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      ALTER COLUMN "status" TYPE "population_import_batch_status_new"
      USING (
        CASE "status"::text
          WHEN 'processing' THEN 'validating'
          WHEN 'previewed' THEN 'ready'
          ELSE "status"::text
        END
      )::"population_import_batch_status_new"
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      ALTER COLUMN "status" SET DEFAULT 'uploaded'
    `);
    await queryRunner.query(`DROP TYPE "population_import_batch_status"`);
    await queryRunner.query(`
      ALTER TYPE "population_import_batch_status_new" RENAME TO "population_import_batch_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      ADD COLUMN "validation_job_id" VARCHAR(100),
      ADD COLUMN "import_job_id" VARCHAR(100),
      ADD COLUMN "last_validated_row_number" INT,
      ADD COLUMN "last_imported_row_number" INT,
      ADD COLUMN "processed_rows" INT,
      ADD COLUMN "validating_started_at" TIMESTAMPTZ,
      ADD COLUMN "importing_started_at" TIMESTAMPTZ,
      ADD COLUMN "completed_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      RENAME COLUMN "previewed_at" TO "ready_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "village_population_import_rows"
      ADD CONSTRAINT "uq_vpir_batch_row" UNIQUE ("batch_id", "row_number")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "village_population_import_rows"
      DROP CONSTRAINT "uq_vpir_batch_row"
    `);

    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      RENAME COLUMN "ready_at" TO "previewed_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      DROP COLUMN "validation_job_id",
      DROP COLUMN "import_job_id",
      DROP COLUMN "last_validated_row_number",
      DROP COLUMN "last_imported_row_number",
      DROP COLUMN "processed_rows",
      DROP COLUMN "validating_started_at",
      DROP COLUMN "importing_started_at",
      DROP COLUMN "completed_at"
    `);

    await queryRunner.query(`
      CREATE TYPE "population_import_batch_status_old" AS ENUM (
        'processing', 'previewed', 'failed', 'importing', 'completed'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches" ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      ALTER COLUMN "status" TYPE "population_import_batch_status_old"
      USING (
        CASE "status"::text
          WHEN 'validating' THEN 'processing'
          WHEN 'ready' THEN 'previewed'
          WHEN 'queued' THEN 'previewed'
          WHEN 'completed_with_errors' THEN 'completed'
          ELSE "status"::text
        END
      )::"population_import_batch_status_old"
    `);
    await queryRunner.query(`
      ALTER TABLE "village_population_import_batches"
      ALTER COLUMN "status" SET DEFAULT 'processing'
    `);
    await queryRunner.query(`DROP TYPE "population_import_batch_status"`);
    await queryRunner.query(`
      ALTER TYPE "population_import_batch_status_old" RENAME TO "population_import_batch_status"
    `);
  }
}
