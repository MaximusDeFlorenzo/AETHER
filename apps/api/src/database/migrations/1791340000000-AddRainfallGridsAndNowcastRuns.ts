import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rainfall Intelligence Milestone 2 (docs/RAINFALL_INTELLIGENCE.md):
 *
 * - `rainfall_grids`: hourly rain fields over the Indonesia domain (GSMaP
 *   subset, gzip float32) — motion tracking and backtesting need fields,
 *   not just district points. Unique (source, valid_time).
 * - `rainfall_nowcast_runs`: one baseline nowcast run with model versions,
 *   data valid times, parameters, input summary and per-district results.
 */
export class AddRainfallGridsAndNowcastRuns1791340000000 implements MigrationInterface {
  name = 'AddRainfallGridsAndNowcastRuns1791340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rainfall_grids" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "source"          VARCHAR(40) NOT NULL,
        "valid_time"      TIMESTAMPTZ NOT NULL,
        "west_lon"        DOUBLE PRECISION NOT NULL,
        "north_lat"       DOUBLE PRECISION NOT NULL,
        "resolution_deg"  DOUBLE PRECISION NOT NULL,
        "nx"              INTEGER NOT NULL,
        "ny"              INTEGER NOT NULL,
        "encoding"        VARCHAR(40) NOT NULL,
        "data"            BYTEA NOT NULL,
        "missing_cells"   INTEGER NOT NULL,
        "retrieved_at"    TIMESTAMPTZ NOT NULL,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_rainfall_grids_source_time" UNIQUE ("source", "valid_time")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rainfall_grids_valid_time" ON "rainfall_grids"(valid_time)`,
    );

    await queryRunner.query(`
      CREATE TABLE "rainfall_nowcast_runs" (
        "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "status"               VARCHAR(30) NOT NULL,
        "trigger"              VARCHAR(20) NOT NULL,
        "issued_at"            TIMESTAMPTZ NOT NULL,
        "data_valid_time"      TIMESTAMPTZ,
        "previous_valid_time"  TIMESTAMPTZ,
        "rain_source"          VARCHAR(40) NOT NULL,
        "model_versions"       JSONB,
        "horizons_hours"       INTEGER[] NOT NULL,
        "parameters"           JSONB NOT NULL,
        "input_summary"        JSONB,
        "results"              JSONB,
        "warnings"             JSONB NOT NULL DEFAULT '[]',
        "error"                TEXT,
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at"         TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rainfall_nowcast_runs_status" ON "rainfall_nowcast_runs"(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rainfall_nowcast_runs_issued_at" ON "rainfall_nowcast_runs"(issued_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rainfall_nowcast_runs"`);
    await queryRunner.query(`DROP TABLE "rainfall_grids"`);
  }
}
