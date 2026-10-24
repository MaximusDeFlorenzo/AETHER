import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rainfall Intelligence Milestone 7 (docs/RAINFALL_INTELLIGENCE.md):
 * `disaster_event_labels` — reported flood/landslide events (BNPB DIBI) used
 * as evaluation labels — and `rainfall_point_archive` — archived hourly
 * rainfall (GSMaP_Gauge standard) at each district point, per UTC day.
 */
export class AddDisasterLabelsAndRainfallArchive1791380000000 implements MigrationInterface {
  name = 'AddDisasterLabelsAndRainfallArchive1791380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "disaster_event_labels" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "source"              VARCHAR(20) NOT NULL,
        "external_id"         VARCHAR(80) NOT NULL,
        "hazard"              VARCHAR(20) NOT NULL,
        "event_type"          VARCHAR(60) NOT NULL,
        "district_id"         UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "region_code"         VARCHAR(10) NOT NULL,
        "local_date"          DATE NOT NULL,
        "local_time"          TIME,
        "dead"                INTEGER NOT NULL DEFAULT 0,
        "missing"             INTEGER NOT NULL DEFAULT 0,
        "affected_displaced"  INTEGER NOT NULL DEFAULT 0,
        "houses_flooded"      INTEGER NOT NULL DEFAULT 0,
        "houses_damaged"      INTEGER NOT NULL DEFAULT 0,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_disaster_event_labels_source_external_hazard" ON "disaster_event_labels"(source, external_id, hazard)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_disaster_event_labels_hazard_date" ON "disaster_event_labels"(hazard, local_date)`,
    );
    await queryRunner.query(`
      CREATE TABLE "rainfall_point_archive" (
        "district_id"      UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "product"          VARCHAR(30) NOT NULL,
        "day"              DATE NOT NULL,
        "hourly_mm"        REAL[] NOT NULL,
        "missing_hours"    SMALLINT NOT NULL,
        "product_version"  VARCHAR(20) NOT NULL,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("district_id", "product", "day"),
        CONSTRAINT "chk_rainfall_point_archive_24_hours" CHECK (array_length(hourly_mm, 1) = 24)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rainfall_point_archive_product_day" ON "rainfall_point_archive"(product, day)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rainfall_point_archive"`);
    await queryRunner.query(`DROP TABLE "disaster_event_labels"`);
  }
}
