import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the administrative resolution of `districts` / `population_statistics`
 * explicit and self-describing instead of implicit-by-convention.
 *
 * `districts` has always been kabupaten/kota (regency/city) level only (see
 * reference-data.seed.ts's 514-row Kemendagri source) — `administrative_level`
 * records that fact on the row itself rather than leaving it to a code
 * comment, so a future finer-resolution table (kecamatan/kelurahan) can never
 * be silently confused with this one.
 *
 * `population_statistics.region_code` + `administrative_level` are
 * denormalized off `districts` (not just derivable through the FK) so every
 * population row is self-describing about exactly which region/level its
 * `total_population`/`population_density` apply to — a consumer reading this
 * table directly (a report query, a future export) doesn't have to join back
 * to `districts` to know it must not treat these numbers as kecamatan- or
 * kelurahan-level population.
 *
 * `region_code` backfills from the owning district's `bps_code`; both new
 * columns default to 'kabupaten_kota' since that's the only level any
 * existing or currently-ingested row represents.
 */
export class AddAdministrativeLevelToPopulationData1790052243653 implements MigrationInterface {
  name = 'AddAdministrativeLevelToPopulationData1790052243653';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "administrative_level" AS ENUM ('kabupaten_kota', 'kecamatan', 'kelurahan_desa')
    `);

    await queryRunner.query(`
      ALTER TABLE "districts"
      ADD COLUMN "administrative_level" administrative_level NOT NULL DEFAULT 'kabupaten_kota'
    `);

    await queryRunner.query(`
      ALTER TABLE "population_statistics"
      ADD COLUMN "region_code" VARCHAR(10),
      ADD COLUMN "administrative_level" administrative_level NOT NULL DEFAULT 'kabupaten_kota'
    `);
    // Backfill from the owning district before enforcing NOT NULL — existing
    // rows (the 514-kabupaten/kota seed) all resolve via this join.
    await queryRunner.query(`
      UPDATE "population_statistics" ps
      SET "region_code" = d."bps_code"
      FROM "districts" d
      WHERE ps."district_id" = d."id"
    `);
    await queryRunner.query(`
      ALTER TABLE "population_statistics"
      ALTER COLUMN "region_code" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "population_statistics"
      DROP COLUMN "region_code",
      DROP COLUMN "administrative_level"
    `);
    await queryRunner.query(`
      ALTER TABLE "districts"
      DROP COLUMN "administrative_level"
    `);
    await queryRunner.query(`DROP TYPE "administrative_level"`);
  }
}
