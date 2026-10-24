import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Karhutla spread + smoke prediction runs (karhutla-prediction/).
 *
 * - `karhutla_prediction_runs`: one pipeline execution, with model
 *   versions, horizons, input provenance and status. A partial unique
 *   index allows at most ONE queued/running run at a time, so concurrent
 *   manual + scheduled triggers collapse into a single job.
 * - `karhutla_cluster_forecasts`: per-hotspot-cluster outputs. Observed
 *   inputs (hotspot ids, pixel footprint) and model outputs (spread/smoke
 *   jsonb) are separate columns.
 */
export class AddKarhutlaPredictions1791120000000 implements MigrationInterface {
  name = 'AddKarhutlaPredictions1791120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "karhutla_run_status" AS ENUM ('queued', 'running', 'completed', 'partial', 'failed')
    `);
    await queryRunner.query(`
      CREATE TYPE "karhutla_run_trigger" AS ENUM ('scheduled', 'manual')
    `);
    await queryRunner.query(`
      CREATE TYPE "karhutla_forecast_status" AS ENUM ('ok', 'partial', 'insufficient_data', 'failed')
    `);
    await queryRunner.query(`
      CREATE TABLE "karhutla_prediction_runs" (
        "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "status"                karhutla_run_status NOT NULL,
        "trigger"               karhutla_run_trigger NOT NULL,
        "requested_by_user_id"  UUID REFERENCES "users"(id) ON DELETE SET NULL,
        "issued_at"             TIMESTAMPTZ,
        "horizons_hours"        INTEGER[] NOT NULL,
        "max_clusters"          INTEGER NOT NULL,
        "hotspot_window_hours"  INTEGER NOT NULL,
        "spread_model_version"  VARCHAR(60),
        "smoke_model_version"   VARCHAR(60),
        "input_summary"         JSONB,
        "warnings"              JSONB NOT NULL DEFAULT '[]',
        "error"                 TEXT,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
        "started_at"            TIMESTAMPTZ,
        "completed_at"          TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_karhutla_runs_status" ON "karhutla_prediction_runs"(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_karhutla_runs_created_at" ON "karhutla_prediction_runs"(created_at)`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_karhutla_runs_single_active" ON "karhutla_prediction_runs"((true))
      WHERE status IN ('queued', 'running')
    `);

    await queryRunner.query(`
      CREATE TABLE "karhutla_cluster_forecasts" (
        "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "run_id"               UUID NOT NULL REFERENCES "karhutla_prediction_runs"(id) ON DELETE CASCADE,
        "rank"                 INTEGER NOT NULL,
        "status"               karhutla_forecast_status NOT NULL,
        "latitude"             NUMERIC(9,6) NOT NULL,
        "longitude"            NUMERIC(9,6) NOT NULL,
        "centroid"             geometry(Point, 4326) NOT NULL,
        "location_label"       VARCHAR(255),
        "nearest_district_id"  UUID REFERENCES "districts"(id) ON DELETE SET NULL,
        "hotspot_count"        INTEGER NOT NULL,
        "total_frp_mw"         NUMERIC(10,2),
        "max_confidence"       NUMERIC(4,3),
        "first_observed_at"    TIMESTAMPTZ NOT NULL,
        "latest_observed_at"   TIMESTAMPTZ NOT NULL,
        "hotspot_event_ids"    UUID[] NOT NULL,
        "sensors"              TEXT[] NOT NULL,
        "observed_footprint"   geometry(Polygon, 4326),
        "spread"               JSONB,
        "smoke"                JSONB,
        "weather"              JSONB,
        "data_quality"         JSONB NOT NULL,
        "exposure"             JSONB NOT NULL DEFAULT '[]',
        "recommendations"      JSONB NOT NULL DEFAULT '[]',
        "confidence"           VARCHAR(20),
        "error"                TEXT,
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_karhutla_forecasts_run" ON "karhutla_cluster_forecasts"(run_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_karhutla_forecasts_centroid" ON "karhutla_cluster_forecasts" USING GIST(centroid)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "karhutla_cluster_forecasts"`);
    await queryRunner.query(`DROP TABLE "karhutla_prediction_runs"`);
    await queryRunner.query(`DROP TYPE "karhutla_forecast_status"`);
    await queryRunner.query(`DROP TYPE "karhutla_run_trigger"`);
    await queryRunner.query(`DROP TYPE "karhutla_run_status"`);
  }
}
