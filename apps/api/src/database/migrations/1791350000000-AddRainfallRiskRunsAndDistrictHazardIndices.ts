import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rainfall Intelligence Milestone 3 (docs/RAINFALL_INTELLIGENCE.md):
 *
 * - `district_hazard_indices`: BNPB InaRISK hazard-index rasters sampled
 *   around each kabupaten/kota point (point + 4 neighbours), refreshed
 *   rarely — the layers are static. Unique (district, layer).
 * - `rainfall_risk_runs`: one flood (later landslide) risk run with model
 *   version, thresholds, input provenance and per-district results.
 */
export class AddRainfallRiskRunsAndDistrictHazardIndices1791350000000 implements MigrationInterface {
  name = 'AddRainfallRiskRunsAndDistrictHazardIndices1791350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "district_hazard_indices" (
        "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"        UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "layer"              VARCHAR(60) NOT NULL,
        "source"             VARCHAR(40) NOT NULL,
        "value_mean"         REAL,
        "value_max"          REAL,
        "value_center"       REAL,
        "samples_total"      INTEGER NOT NULL,
        "samples_valid"      INTEGER NOT NULL,
        "sample_offset_deg"  REAL NOT NULL,
        "sampled_at"         TIMESTAMPTZ NOT NULL,
        CONSTRAINT "uq_district_hazard_indices_district_layer" UNIQUE ("district_id", "layer")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "rainfall_risk_runs" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "hazard"           VARCHAR(20) NOT NULL,
        "status"           VARCHAR(30) NOT NULL,
        "trigger"          VARCHAR(20) NOT NULL,
        "issued_at"        TIMESTAMPTZ NOT NULL,
        "data_valid_time"  TIMESTAMPTZ,
        "model_version"    VARCHAR(60),
        "parameters"       JSONB NOT NULL,
        "input_summary"    JSONB,
        "results"          JSONB,
        "warnings"         JSONB NOT NULL DEFAULT '[]',
        "error"            TEXT,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at"     TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rainfall_risk_runs_hazard_issued_at" ON "rainfall_risk_runs"(hazard, issued_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rainfall_risk_runs"`);
    await queryRunner.query(`DROP TABLE "district_hazard_indices"`);
  }
}
