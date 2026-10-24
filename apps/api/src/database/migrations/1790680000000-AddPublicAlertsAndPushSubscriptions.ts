import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Citizen emergency alarms ("layar merah") and the anonymous Web Push
 * subscriptions they are delivered to.
 *
 * - `public_alerts`: one operator-issued life-saving instruction for one
 *   area (district, optionally narrowed to a subdistrict/village), with a
 *   hard `expires_at` so a forgotten alarm stops on its own.
 * - `push_subscriptions`: a browser's Web Push endpoint + keys, tied to the
 *   area the citizen picked. No account, name, phone or precise location.
 * - `public_alert_responses`: "Saya sudah aman" / "Butuh bantuan", one row
 *   per anonymous device per alert.
 */
export class AddPublicAlertsAndPushSubscriptions1790680000000 implements MigrationInterface {
  name = 'AddPublicAlertsAndPushSubscriptions1790680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public_alert_hazard" AS ENUM
        ('flood', 'landslide', 'earthquake', 'tsunami', 'volcano', 'wildfire_smoke', 'other')
    `);
    await queryRunner.query(`
      CREATE TYPE "public_alert_status" AS ENUM ('active', 'ended')
    `);
    await queryRunner.query(`
      CREATE TYPE "public_alert_response_status" AS ENUM ('safe', 'needs_help')
    `);

    await queryRunner.query(`
      CREATE TABLE "public_alerts" (
        "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "hazard"                 public_alert_hazard NOT NULL,
        "status"                 public_alert_status NOT NULL DEFAULT 'active',
        "title"                  VARCHAR(120) NOT NULL,
        "action"                 VARCHAR(160) NOT NULL,
        "message"                TEXT NOT NULL,
        "destination_name"       VARCHAR(200),
        "destination_latitude"   NUMERIC(9,6),
        "destination_longitude"  NUMERIC(9,6),
        "avoid_text"             VARCHAR(300),
        "source_label"           VARCHAR(160) NOT NULL,
        "district_id"            UUID NOT NULL REFERENCES "districts"(id),
        "subdistrict_id"         UUID REFERENCES "subdistricts"(id),
        "village_id"             UUID REFERENCES "villages"(id),
        "hazard_event_id"        UUID REFERENCES "hazard_events"(id) ON DELETE SET NULL,
        "created_by_user_id"     UUID REFERENCES "users"(id) ON DELETE SET NULL,
        "push_sent_count"        INTEGER NOT NULL DEFAULT 0,
        "push_failed_count"      INTEGER NOT NULL DEFAULT 0,
        "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expires_at"             TIMESTAMPTZ NOT NULL,
        "ended_at"               TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_public_alerts_district" ON "public_alerts"(district_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_public_alerts_status" ON "public_alerts"(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_public_alerts_expires_at" ON "public_alerts"(expires_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE "push_subscriptions" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "endpoint"         TEXT NOT NULL UNIQUE,
        "p256dh"           VARCHAR(255) NOT NULL,
        "auth"             VARCHAR(255) NOT NULL,
        "district_id"      UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "subdistrict_id"   UUID REFERENCES "subdistricts"(id) ON DELETE SET NULL,
        "village_id"       UUID REFERENCES "villages"(id) ON DELETE SET NULL,
        "user_agent"       VARCHAR(255),
        "last_success_at"  TIMESTAMPTZ,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_push_subscriptions_district" ON "push_subscriptions"(district_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE "public_alert_responses" (
        "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "alert_id"    UUID NOT NULL REFERENCES "public_alerts"(id) ON DELETE CASCADE,
        "device_id"   VARCHAR(64) NOT NULL,
        "status"      public_alert_response_status NOT NULL,
        "latitude"    NUMERIC(9,6),
        "longitude"   NUMERIC(9,6),
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_public_alert_response_device" UNIQUE ("alert_id", "device_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_public_alert_responses_alert" ON "public_alert_responses"(alert_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "public_alert_responses"`);
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
    await queryRunner.query(`DROP TABLE "public_alerts"`);
    await queryRunner.query(`DROP TYPE "public_alert_response_status"`);
    await queryRunner.query(`DROP TYPE "public_alert_status"`);
    await queryRunner.query(`DROP TYPE "public_alert_hazard"`);
  }
}
