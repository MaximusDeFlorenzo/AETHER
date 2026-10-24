import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AETHER Ground Intelligence M1: community ground reports, their evidence
 * photos and an append-only review history. Reports are deliberately
 * separate from `hazard_events` — no report, verified or not, reaches risk
 * scoring or notifications through this schema.
 */
export class AddGroundReports1791390000000 implements MigrationInterface {
  name = 'AddGroundReports1791390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "ground_observation_type" AS ENUM ('floodwater', 'fire', 'smoke')`,
    );
    await queryRunner.query(`
      CREATE TYPE "ground_report_status" AS ENUM
        ('submitted', 'under_review', 'needs_more_evidence', 'corroborated',
         'verified', 'rejected', 'unverifiable')
    `);
    await queryRunner.query(
      `CREATE TYPE "ground_report_severity" AS ENUM ('low', 'moderate', 'high', 'severe')`,
    );

    await queryRunner.query(`
      CREATE TABLE "ground_reports" (
        "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "observation_type"          ground_observation_type NOT NULL,
        "status"                    ground_report_status NOT NULL DEFAULT 'submitted',
        "latitude"                  NUMERIC(9,6) NOT NULL,
        "longitude"                 NUMERIC(9,6) NOT NULL,
        "geom"                      geometry(Point, 4326) NOT NULL,
        "nearest_district_id"       UUID REFERENCES "districts"(id) ON DELETE SET NULL,
        "observed_at"               TIMESTAMPTZ NOT NULL,
        "submitted_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        "description"               TEXT NOT NULL,
        "water_depth_cm"            INTEGER,
        "reporter_severity"         ground_report_severity,
        "reporter_user_id"          UUID NOT NULL REFERENCES "users"(id) ON DELETE RESTRICT,
        "duplicate_of_id"           UUID REFERENCES "ground_reports"(id) ON DELETE SET NULL,
        "training_eligible"         BOOLEAN NOT NULL DEFAULT false,
        "last_reviewed_by_user_id"  UUID REFERENCES "users"(id) ON DELETE SET NULL,
        "last_reviewed_at"          TIMESTAMPTZ,
        "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_ground_reports_water_depth" CHECK (
          water_depth_cm IS NULL
          OR (observation_type = 'floodwater' AND water_depth_cm BETWEEN 0 AND 1000)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ground_reports_status" ON "ground_reports"(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ground_reports_reporter_submitted" ON "ground_reports"(reporter_user_id, submitted_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ground_reports_geom" ON "ground_reports" USING GIST (geom)`,
    );

    await queryRunner.query(`
      CREATE TABLE "ground_report_evidence" (
        "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "report_id"                 UUID NOT NULL REFERENCES "ground_reports"(id) ON DELETE RESTRICT,
        "storage_key"               TEXT NOT NULL,
        "mime_type"                 VARCHAR(40) NOT NULL,
        "size_bytes"                INTEGER NOT NULL,
        "sha256"                    CHAR(64) NOT NULL,
        "exif"                      JSONB,
        "cv_hint"                   JSONB,
        "duplicate_of_evidence_id"  UUID REFERENCES "ground_report_evidence"(id) ON DELETE SET NULL,
        "uploaded_by_user_id"       UUID NOT NULL REFERENCES "users"(id) ON DELETE RESTRICT,
        "created_at"                TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ground_report_evidence_report" ON "ground_report_evidence"(report_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ground_report_evidence_sha256" ON "ground_report_evidence"(sha256)`,
    );

    await queryRunner.query(`
      CREATE TABLE "ground_report_status_changes" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "report_id"      UUID NOT NULL REFERENCES "ground_reports"(id) ON DELETE RESTRICT,
        "from_status"    ground_report_status,
        "to_status"      ground_report_status NOT NULL,
        "actor_user_id"  UUID NOT NULL REFERENCES "users"(id) ON DELETE RESTRICT,
        "reason"         TEXT,
        "notes"          TEXT,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ground_report_status_changes_report" ON "ground_report_status_changes"(report_id, created_at)`,
    );

    // Review history is append-only at the database level, not just by
    // having no update/delete endpoint.
    await queryRunner.query(`
      CREATE FUNCTION "ground_report_status_changes_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ground_report_status_changes is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_ground_report_status_changes_append_only"
      BEFORE UPDATE OR DELETE ON "ground_report_status_changes"
      FOR EACH ROW EXECUTE FUNCTION "ground_report_status_changes_append_only"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ground_report_status_changes"`);
    await queryRunner.query(
      `DROP FUNCTION "ground_report_status_changes_append_only"()`,
    );
    await queryRunner.query(`DROP TABLE "ground_report_evidence"`);
    await queryRunner.query(`DROP TABLE "ground_reports"`);
    await queryRunner.query(`DROP TYPE "ground_report_severity"`);
    await queryRunner.query(`DROP TYPE "ground_report_status"`);
    await queryRunner.query(`DROP TYPE "ground_observation_type"`);
  }
}
