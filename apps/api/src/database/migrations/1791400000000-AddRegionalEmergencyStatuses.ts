import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Official regional emergency statuses (Siaga Darurat / Tanggap Darurat /
 * Transisi Darurat) declared by a Pemda decree for a kabupaten/kota. Unlike
 * `public_alerts` (a short, loud alarm) these last weeks and only set a
 * floor on the citizen portal's level — they never trigger push/sirens.
 * Reuses the `public_alert_hazard` vocabulary.
 */
export class AddRegionalEmergencyStatuses1791400000000 implements MigrationInterface {
  name = 'AddRegionalEmergencyStatuses1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "emergency_phase" AS ENUM ('siaga_darurat', 'tanggap_darurat', 'transisi_darurat')`,
    );
    await queryRunner.query(`
      CREATE TABLE "regional_emergency_statuses" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"         UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "phase"               emergency_phase NOT NULL,
        "hazard"              public_alert_hazard NOT NULL,
        "starts_on"           DATE NOT NULL,
        "ends_on"             DATE NOT NULL,
        "decree_number"       VARCHAR(160),
        "source_label"        VARCHAR(160) NOT NULL,
        "source_url"          VARCHAR(500),
        "note"                TEXT,
        "created_by_user_id"  UUID REFERENCES "users"(id) ON DELETE SET NULL,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ended_at"            TIMESTAMPTZ,
        CONSTRAINT "chk_regional_emergency_statuses_dates" CHECK (ends_on >= starts_on)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_regional_emergency_statuses_district" ON "regional_emergency_statuses" ("district_id", "ends_on")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "regional_emergency_statuses"`);
    await queryRunner.query(`DROP TYPE "emergency_phase"`);
  }
}
