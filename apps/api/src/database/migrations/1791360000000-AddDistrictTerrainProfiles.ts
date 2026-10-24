import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rainfall Intelligence Milestone 4 (docs/RAINFALL_INTELLIGENCE.md):
 * `district_terrain_profiles` — Copernicus GLO-90 DEM slope samples around
 * each kabupaten/kota point, one row per district, refreshed rarely (the
 * DEM is static).
 */
export class AddDistrictTerrainProfiles1791360000000 implements MigrationInterface {
  name = 'AddDistrictTerrainProfiles1791360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "district_terrain_profiles" (
        "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"          UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "source"               VARCHAR(40) NOT NULL,
        "dem"                  VARCHAR(60) NOT NULL,
        "slope_samples_deg"    JSONB NOT NULL,
        "slope_median_deg"     REAL,
        "slope_max_deg"        REAL,
        "elevation_mean_m"     INTEGER,
        "elevation_min_m"      INTEGER,
        "elevation_max_m"      INTEGER,
        "samples_planned"      INTEGER NOT NULL,
        "samples_valid"        INTEGER NOT NULL,
        "grid_half_width_deg"  REAL NOT NULL,
        "stencil_offset_deg"   REAL NOT NULL,
        "sampled_at"           TIMESTAMPTZ NOT NULL,
        CONSTRAINT "uq_district_terrain_profiles_district" UNIQUE ("district_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "district_terrain_profiles"`);
  }
}
