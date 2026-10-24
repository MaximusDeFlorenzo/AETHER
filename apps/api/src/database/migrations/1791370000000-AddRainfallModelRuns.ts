import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rainfall Intelligence Milestone 5 (docs/RAINFALL_INTELLIGENCE.md):
 * `rainfall_model_runs` — training/evaluation runs of gated models (first:
 * the Stage-2 spatial rain nowcast), with the promotion verdict per horizon.
 */
export class AddRainfallModelRuns1791370000000 implements MigrationInterface {
  name = 'AddRainfallModelRuns1791370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rainfall_model_runs" (
        "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "task"               VARCHAR(40) NOT NULL,
        "status"             VARCHAR(30) NOT NULL,
        "trigger"            VARCHAR(20) NOT NULL,
        "issued_at"          TIMESTAMPTZ NOT NULL,
        "model_version"      VARCHAR(60),
        "data_summary"       JSONB,
        "parameters"         JSONB NOT NULL,
        "results"            JSONB,
        "promoted_horizons"  JSONB NOT NULL DEFAULT '[]',
        "warnings"           JSONB NOT NULL DEFAULT '[]',
        "error"              TEXT,
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at"       TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rainfall_model_runs_task_issued_at" ON "rainfall_model_runs"(task, issued_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rainfall_model_runs"`);
  }
}
