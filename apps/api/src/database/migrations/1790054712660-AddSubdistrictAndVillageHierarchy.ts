import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends the region hierarchy one and two levels below `districts`
 * (kabupaten/kota): `subdistricts` (kecamatan) and `villages`
 * (kelurahan/desa), each FK'd to its real parent (never name-matched).
 * Codes/names are real (Kepmendagri No 300.2.2-2138 Tahun 2025, via
 * github.com/cahyadsn/wilayah, verified 2026-09-22 — 7,285 kecamatan /
 * 83,762 kelurahan/desa, zero unmapped parents, zero duplicate codes).
 *
 * Deliberately NOT added: population/area/geometry columns on either new
 * table. No verified source provides them at these levels (see
 * AdministrativeLevel's comment in domain.enum.ts) — adding empty columns
 * now would misrepresent unavailable data as a schema-level guarantee.
 *
 * `code_system` on `districts` is additive metadata, not a data change:
 * every existing `bps_code` value already came from Kemendagri (see
 * district.entity.ts's comment) — this migration just records that
 * explicitly instead of leaving it implied by the (misleading) column name.
 *
 * `districts`/`subdistricts`/`villages` are all pure reference data with no
 * write endpoint (same posture as the existing districts/provinces tables),
 * so this migration only creates schema — importing the actual 91,047 rows
 * is a separate seed script (seed-subdistricts-and-villages.ts).
 */
export class AddSubdistrictAndVillageHierarchy1790054712660 implements MigrationInterface {
  name = 'AddSubdistrictAndVillageHierarchy1790054712660';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "region_code_system" AS ENUM ('kemendagri')
    `);

    await queryRunner.query(`
      ALTER TABLE "districts"
      ADD COLUMN "code_system" region_code_system NOT NULL DEFAULT 'kemendagri'
    `);

    await queryRunner.query(`
      CREATE TABLE "subdistricts" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"         UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "code"                VARCHAR(20) NOT NULL UNIQUE,
        "code_system"         region_code_system NOT NULL DEFAULT 'kemendagri',
        "administrative_level" administrative_level NOT NULL DEFAULT 'kecamatan',
        "name"                VARCHAR(120) NOT NULL,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_subdistricts_district" ON "subdistricts"(district_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_subdistricts_name" ON "subdistricts"(name)`,
    );

    await queryRunner.query(`
      CREATE TABLE "villages" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subdistrict_id"      UUID NOT NULL REFERENCES "subdistricts"(id) ON DELETE CASCADE,
        "code"                VARCHAR(20) NOT NULL UNIQUE,
        "code_system"         region_code_system NOT NULL DEFAULT 'kemendagri',
        "administrative_level" administrative_level NOT NULL DEFAULT 'kelurahan_desa',
        "name"                VARCHAR(120) NOT NULL,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_villages_subdistrict" ON "villages"(subdistrict_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_villages_name" ON "villages"(name)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "villages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subdistricts"`);
    await queryRunner.query(
      `ALTER TABLE "districts" DROP COLUMN "code_system"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "region_code_system"`);
  }
}
