import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds kecamatan/kelurahan population import: `village_population_import_batches`
 * (one row per CSV upload, reopenable status/summary),
 * `village_population_import_rows` (full per-row parse/validate/match audit
 * trail), and `village_populations` (the actual imported population data,
 * FK'd to `villages`).
 *
 * `villages`/`subdistricts`/`districts` are untouched — this only adds new
 * tables, no column changes to the existing hierarchy.
 *
 * `village_populations.dedupe_key` is NOT NULL by design (see its entity's
 * top comment) specifically so `UNIQUE(village_id, dedupe_key)` catches
 * duplicate "unknown period" rows for the same village, which a unique
 * constraint over a nullable `period_year` alone would miss (Postgres
 * treats every NULL as distinct).
 */
export class AddVillagePopulationImport1790061058822 implements MigrationInterface {
  name = 'AddVillagePopulationImport1790061058822';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "population_import_batch_status" AS ENUM (
        'processing', 'previewed', 'failed', 'importing', 'completed'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "population_import_row_status" AS ENUM (
        'valid', 'duplicate_in_file', 'unchanged', 'conflict', 'invalid',
        'region_not_found', 'hierarchy_mismatch', 'needs_review', 'imported', 'skipped'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "population_number_format" AS ENUM (
        'dot_thousands_separator', 'dot_decimal_point'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "population_period_status" AS ENUM ('confirmed', 'unknown')
    `);

    await queryRunner.query(`
      CREATE TABLE "village_population_import_batches" (
        "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "file_name"                VARCHAR(255) NOT NULL,
        "file_checksum_sha256"     VARCHAR(64) NOT NULL,
        "file_size_bytes"          BIGINT NOT NULL,
        "storage_key"              VARCHAR(500) NOT NULL,
        "uploaded_by_user_id"      UUID NOT NULL REFERENCES "users"(id),
        "has_header_row"           BOOLEAN NOT NULL,
        "number_format"            population_number_format NOT NULL,
        "source_name"              VARCHAR(200) NOT NULL,
        "source_reference"         TEXT,
        "period_status"            population_period_status NOT NULL,
        "period_year"              SMALLINT,
        "status"                   population_import_batch_status NOT NULL DEFAULT 'processing',
        "total_rows"               INT,
        "valid_row_count"          INT,
        "duplicate_in_file_count"  INT,
        "unchanged_count"          INT,
        "conflict_count"           INT,
        "invalid_count"            INT,
        "imported_count"           INT,
        "skipped_count"            INT,
        "error_message"            TEXT,
        "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),
        "previewed_at"             TIMESTAMPTZ,
        "confirmed_at"             TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vpib_checksum" ON "village_population_import_batches"(file_checksum_sha256)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vpib_uploaded_by" ON "village_population_import_batches"(uploaded_by_user_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE "village_population_import_rows" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "batch_id"          UUID NOT NULL REFERENCES "village_population_import_batches"(id) ON DELETE CASCADE,
        "row_number"        INT NOT NULL,
        "raw_line"          TEXT NOT NULL,
        "raw_fields"        JSONB NOT NULL,
        "kode_pum"          VARCHAR(30),
        "normalized_code"   VARCHAR(20),
        "matched_village_id" UUID REFERENCES "villages"(id),
        "parsed_date_raw"   VARCHAR(30),
        "parsed_date"       DATE,
        "male"              INT,
        "female"            INT,
        "total_population"  INT,
        "households"        INT,
        "density_raw"       VARCHAR(30),
        "density_converted" NUMERIC(12,3),
        "status"            population_import_row_status NOT NULL,
        "messages"          JSONB NOT NULL DEFAULT '[]',
        "dedupe_key"        VARCHAR(300) NOT NULL,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vpir_batch" ON "village_population_import_rows"(batch_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vpir_matched_village" ON "village_population_import_rows"(matched_village_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vpir_status" ON "village_population_import_rows"(batch_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE "village_populations" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "village_id"        UUID NOT NULL REFERENCES "villages"(id) ON DELETE CASCADE,
        "male"              INT,
        "female"            INT,
        "total_population"  INT,
        "households"        INT,
        "density_raw"       VARCHAR(30),
        "density_converted" NUMERIC(12,3),
        "number_format"     population_number_format,
        "reported_date"     DATE,
        "period_status"     population_period_status NOT NULL,
        "period_year"       SMALLINT,
        "dedupe_key"        VARCHAR(300) NOT NULL,
        "source_name"       VARCHAR(200) NOT NULL,
        "source_reference"  TEXT,
        "import_batch_id"   UUID REFERENCES "village_population_import_batches"(id) ON DELETE SET NULL,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (village_id, dedupe_key)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vp_village" ON "village_populations"(village_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vp_import_batch" ON "village_populations"(import_batch_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "village_populations"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "village_population_import_rows"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "village_population_import_batches"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "population_period_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "population_number_format"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "population_import_row_status"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "population_import_batch_status"`,
    );
  }
}
