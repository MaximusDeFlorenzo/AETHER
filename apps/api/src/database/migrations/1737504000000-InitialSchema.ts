import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates every Phase-1-relevant table in docs/DATABASE_SCHEMA.md, hand-
 * written to match that document exactly (rather than TypeORM
 * migration:generate output) since it is the source of truth. Table/column
 * order follows the doc's section numbering (§1-24).
 */
export class InitialSchema1737504000000 implements MigrationInterface {
  name = 'InitialSchema1737504000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "postgis"`);

    // --- Enum types -------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "hazard_type" AS ENUM ('earthquake', 'flood', 'landslide', 'wildfire')`,
    );
    await queryRunner.query(
      `CREATE TYPE "notification_type" AS ENUM ('new_hazard_event', 'high_risk_assessment', 'hazard_relationship_detected', 'system')`,
    );
    await queryRunner.query(
      `CREATE TYPE "hazard_relationship_type" AS ENUM ('triggers', 'exacerbates', 'coincides')`,
    );
    await queryRunner.query(
      `CREATE TYPE "exposure_level" AS ENUM ('low', 'moderate', 'high', 'severe')`,
    );
    await queryRunner.query(
      `CREATE TYPE "risk_assessment_status" AS ENUM ('pending', 'completed', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "priority_level" AS ENUM ('low', 'medium', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "cv_detection_type" AS ENUM ('flood', 'smoke', 'fire', 'infra_damage')`,
    );

    // --- §1 roles ----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id"          SMALLSERIAL PRIMARY KEY,
        "name"        VARCHAR(40) NOT NULL UNIQUE,
        "description" TEXT
      )
    `);
    await queryRunner.query(`
      INSERT INTO "roles" (name, description) VALUES
        ('admin', 'Full system access'),
        ('agency_operator', 'Manages historical disaster records and resource plans'),
        ('analyst', 'Reviews risk assessments, decision recommendations, sustainability metrics'),
        ('field_reporter', 'Submits ground-truth reports and CV imagery (Phase 2)')
    `);

    // --- §2 users ------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email"         VARCHAR(255) NOT NULL UNIQUE,
        "password_hash" TEXT NOT NULL,
        "full_name"     VARCHAR(150) NOT NULL,
        "role_id"       SMALLINT NOT NULL REFERENCES "roles"(id),
        "is_active"     BOOLEAN NOT NULL DEFAULT true,
        "last_login_at" TIMESTAMPTZ,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_users_role" ON "users"(role_id)`,
    );

    // --- §3 refresh_tokens -----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"     UUID NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
        "token_hash"  TEXT NOT NULL UNIQUE,
        "expires_at"  TIMESTAMPTZ NOT NULL,
        "revoked_at"  TIMESTAMPTZ,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens"(user_id)`,
    );

    // --- §4 provinces --------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "provinces" (
        "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "bps_code"   VARCHAR(10) NOT NULL UNIQUE,
        "name"       VARCHAR(120) NOT NULL,
        "geom"       GEOMETRY(MultiPolygon, 4326),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_provinces_geom" ON "provinces" USING GIST (geom)`,
    );

    // --- §5 districts --------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "districts" (
        "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "province_id"  UUID NOT NULL REFERENCES "provinces"(id),
        "bps_code"     VARCHAR(10) NOT NULL UNIQUE,
        "name"         VARCHAR(120) NOT NULL,
        "geom"         GEOMETRY(Geometry, 4326) NOT NULL,
        "area_km2"     NUMERIC(12,2),
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_districts_geom" ON "districts" USING GIST (geom)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_districts_province" ON "districts"(province_id)`,
    );

    // --- §6 population_statistics ---------------------------------------
    await queryRunner.query(`
      CREATE TABLE "population_statistics" (
        "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"        UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "year"               SMALLINT NOT NULL,
        "total_population"   BIGINT NOT NULL,
        "population_density" NUMERIC(10,2) NOT NULL,
        "source"             VARCHAR(60) NOT NULL DEFAULT 'BPS',
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (district_id, year)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_population_district" ON "population_statistics"(district_id)`,
    );

    // --- §7 audit_logs -------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_user_id" UUID REFERENCES "users"(id),
        "action"        VARCHAR(80) NOT NULL,
        "target_type"   VARCHAR(60),
        "target_id"     UUID,
        "metadata"      JSONB,
        "ip_address"    INET,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_actor" ON "audit_logs"(actor_user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_created" ON "audit_logs"(created_at DESC)`,
    );

    // --- §8 historical_disasters -----------------------------------------
    await queryRunner.query(`
      CREATE TABLE "historical_disasters" (
        "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "hazard_type"             hazard_type NOT NULL,
        "province_id"             UUID NOT NULL REFERENCES "provinces"(id),
        "district_id"             UUID REFERENCES "districts"(id),
        "event_date"              DATE NOT NULL,
        "magnitude"               NUMERIC(3,1),
        "casualties_dead"         INTEGER NOT NULL DEFAULT 0,
        "casualties_injured"      INTEGER NOT NULL DEFAULT 0,
        "casualties_missing"      INTEGER NOT NULL DEFAULT 0,
        "displaced_population"    INTEGER NOT NULL DEFAULT 0,
        "damaged_buildings_count" INTEGER NOT NULL DEFAULT 0,
        "damage_description"      TEXT,
        "source"                  VARCHAR(60) NOT NULL DEFAULT 'BNPB',
        "created_by"              UUID REFERENCES "users"(id),
        "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_historical_hazard_type" ON "historical_disasters"(hazard_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_historical_province" ON "historical_disasters"(province_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_historical_district" ON "historical_disasters"(district_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_historical_event_date" ON "historical_disasters"(event_date DESC)`,
    );

    // --- §10 hazard_events -----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "hazard_events" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "hazard_type"    hazard_type NOT NULL,
        "external_id"    VARCHAR(100),
        "latitude"       NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        "longitude"      NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        "geom"           GEOMETRY(Point, 4326) NOT NULL,
        "location_label" VARCHAR(255),
        "region"         VARCHAR(120),
        "event_time"     TIMESTAMPTZ NOT NULL,
        "source"         VARCHAR(60) NOT NULL,
        "raw_payload"    JSONB NOT NULL,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_hazard_event_dedupe" UNIQUE (external_id, source)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_hazard_events_geom" ON "hazard_events" USING GIST (geom)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hazard_events_type" ON "hazard_events"(hazard_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hazard_events_event_time" ON "hazard_events"(event_time DESC)`,
    );

    // --- §11 earthquake_details -------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "earthquake_details" (
        "hazard_event_id"   UUID PRIMARY KEY REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "magnitude"         NUMERIC(3,1) NOT NULL CHECK (magnitude > 0 AND magnitude < 10),
        "depth_km"          NUMERIC(6,1) NOT NULL CHECK (depth_km >= 0),
        "potential_tsunami" BOOLEAN NOT NULL DEFAULT false
      )
    `);

    // --- §12 landslide_details -------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "landslide_details" (
        "hazard_event_id"        UUID PRIMARY KEY REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "slope_degrees"          NUMERIC(5,2),
        "soil_saturation"        NUMERIC(4,3),
        "triggering_rainfall_mm" NUMERIC(7,2)
      )
    `);

    // --- §13 flood_details (Phase 2) ---------------------------------------
    await queryRunner.query(`
      CREATE TABLE "flood_details" (
        "hazard_event_id" UUID PRIMARY KEY REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "rainfall_mm"      NUMERIC(7,2),
        "water_level_m"    NUMERIC(6,2),
        "river_basin"      VARCHAR(120)
      )
    `);

    // --- §14 wildfire_details (Phase 2) ------------------------------------
    await queryRunner.query(`
      CREATE TABLE "wildfire_details" (
        "hazard_event_id"   UUID PRIMARY KEY REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "frp_confidence"    NUMERIC(4,3),
        "hotspot_count"     INTEGER,
        "brightness_kelvin" NUMERIC(7,2)
      )
    `);

    // --- §15 hazard_affected_regions ---------------------------------------
    await queryRunner.query(`
      CREATE TABLE "hazard_affected_regions" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "hazard_event_id" UUID NOT NULL REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "district_id"     UUID NOT NULL REFERENCES "districts"(id),
        "distance_km"     NUMERIC(8,2) NOT NULL,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (hazard_event_id, district_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_har_hazard_event" ON "hazard_affected_regions"(hazard_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_har_district" ON "hazard_affected_regions"(district_id)`,
    );

    // --- §16 hazard_relationships -------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "hazard_relationships" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_event_id"   UUID NOT NULL REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "related_event_id"  UUID NOT NULL REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "relationship_type" hazard_relationship_type NOT NULL,
        "confidence_score"  NUMERIC(4,3) NOT NULL,
        "detected_by"       VARCHAR(60) NOT NULL DEFAULT 'spatial_intelligence_engine',
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (source_event_id, related_event_id, relationship_type)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_hazard_rel_source" ON "hazard_relationships"(source_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hazard_rel_related" ON "hazard_relationships"(related_event_id)`,
    );

    // --- §17 risk_assessments -----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "risk_assessments" (
        "id"                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "hazard_event_id"                UUID REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "hazard_type"                    hazard_type NOT NULL,
        "district_id"                    UUID NOT NULL REFERENCES "districts"(id),
        "risk_score"                     NUMERIC(5,2) NOT NULL,
        "exposure_level"                 exposure_level,
        "estimated_affected_population"  BIGINT,
        "confidence_score"               NUMERIC(4,3),
        "model_version"                  VARCHAR(40),
        "input_snapshot"                 JSONB NOT NULL,
        "status"                         risk_assessment_status NOT NULL DEFAULT 'pending',
        "error_message"                  TEXT,
        "assessed_at"                    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at"                     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"                     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_risk_assessments_hazard_event" ON "risk_assessments"(hazard_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_risk_assessments_district" ON "risk_assessments"(district_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_risk_assessments_status" ON "risk_assessments"(status)`,
    );
    await queryRunner.query(`
      CREATE INDEX "idx_risk_assessments_baseline" ON "risk_assessments"(district_id, assessed_at DESC)
        WHERE hazard_event_id IS NULL
    `);

    // --- §18 decision_recommendations ------------------------------------
    await queryRunner.query(`
      CREATE TABLE "decision_recommendations" (
        "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "risk_assessment_id"    UUID NOT NULL REFERENCES "risk_assessments"(id) ON DELETE CASCADE,
        "priority_level"        priority_level NOT NULL,
        "priority_score"        NUMERIC(5,2) NOT NULL,
        "confidence_score"      NUMERIC(4,3) NOT NULL,
        "summary_text"          TEXT NOT NULL,
        "reasons"               JSONB NOT NULL,
        "action_recommendation" TEXT,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (risk_assessment_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_decision_rec_priority" ON "decision_recommendations"(priority_level, priority_score DESC)`,
    );

    // --- §9 notifications (after hazard_events/decision_recommendations) ---
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"                   UUID REFERENCES "users"(id) ON DELETE CASCADE,
        "type"                      notification_type NOT NULL,
        "title"                     VARCHAR(200) NOT NULL,
        "body"                      TEXT,
        "related_hazard_event_id"   UUID REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "related_recommendation_id" UUID REFERENCES "decision_recommendations"(id) ON DELETE CASCADE,
        "is_read"                   BOOLEAN NOT NULL DEFAULT false,
        "created_at"                TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_user_unread" ON "notifications"(user_id, is_read)`,
    );

    // --- §19 vulnerability_indicators --------------------------------------
    await queryRunner.query(`
      CREATE TABLE "vulnerability_indicators" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"    UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "indicator_type" VARCHAR(80) NOT NULL,
        "value"          NUMERIC(10,4) NOT NULL,
        "unit"           VARCHAR(40),
        "year"           SMALLINT NOT NULL,
        "source"         VARCHAR(60),
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (district_id, indicator_type, year)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vuln_indicators_district" ON "vulnerability_indicators"(district_id)`,
    );

    // --- §20 resource_optimization_plans ------------------------------------
    await queryRunner.query(`
      CREATE TABLE "resource_optimization_plans" (
        "id"                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"                 UUID NOT NULL REFERENCES "districts"(id),
        "hazard_event_id"             UUID REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "risk_assessment_id"          UUID REFERENCES "risk_assessments"(id) ON DELETE CASCADE,
        "plan_type"                   VARCHAR(60) NOT NULL,
        "plan_details"                JSONB NOT NULL,
        "estimated_personnel_needed"  INTEGER,
        "status"                      VARCHAR(40) NOT NULL DEFAULT 'draft',
        "created_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_resource_plans_district" ON "resource_optimization_plans"(district_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_resource_plans_hazard_event" ON "resource_optimization_plans"(hazard_event_id)`,
    );

    // --- §21 shelters -----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "shelters" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"       UUID NOT NULL REFERENCES "districts"(id),
        "name"              VARCHAR(200) NOT NULL,
        "geom"              GEOMETRY(Point, 4326) NOT NULL,
        "capacity"          INTEGER NOT NULL,
        "current_occupancy" INTEGER NOT NULL DEFAULT 0,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_shelters_geom" ON "shelters" USING GIST (geom)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_shelters_district" ON "shelters"(district_id)`,
    );

    // --- §22 cv_detections (Phase 2) ----------------------------------------
    await queryRunner.query(`
      CREATE TABLE "cv_detections" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "detection_type"   cv_detection_type NOT NULL,
        "hazard_event_id"  UUID REFERENCES "hazard_events"(id) ON DELETE CASCADE,
        "source_image_ref" TEXT NOT NULL,
        "bounding_boxes"   JSONB NOT NULL,
        "confidence_score" NUMERIC(4,3) NOT NULL,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_cv_detections_hazard_event" ON "cv_detections"(hazard_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cv_detections_type" ON "cv_detections"(detection_type)`,
    );

    // --- §23 sustainability_metrics -----------------------------------------
    await queryRunner.query(`
      CREATE TABLE "sustainability_metrics" (
        "id"                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"                UUID NOT NULL REFERENCES "districts"(id),
        "period_start"               DATE NOT NULL,
        "period_end"                 DATE NOT NULL,
        "sdg_indicators"             JSONB NOT NULL DEFAULT '{}',
        "climate_resilience_score"   NUMERIC(5,2),
        "carbon_reduction_estimate"  NUMERIC(12,2),
        "protected_population"       BIGINT,
        "response_efficiency_score"  NUMERIC(5,2),
        "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (district_id, period_start, period_end)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_sustainability_district" ON "sustainability_metrics"(district_id)`,
    );

    // --- §24 data_source_syncs -----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "data_source_syncs" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_id"      VARCHAR(60) NOT NULL UNIQUE,
        "last_synced_at" TIMESTAMPTZ,
        "status"         VARCHAR(40) NOT NULL DEFAULT 'never_run',
        "error_message"  TEXT,
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "data_source_syncs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sustainability_metrics"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cv_detections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "shelters"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "resource_optimization_plans"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vulnerability_indicators"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "decision_recommendations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_assessments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hazard_relationships"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hazard_affected_regions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wildfire_details"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "flood_details"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "landslide_details"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "earthquake_details"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hazard_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "historical_disasters"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "population_statistics"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "districts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "provinces"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "cv_detection_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "priority_level"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "risk_assessment_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "exposure_level"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "hazard_relationship_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "hazard_type"`);
  }
}
