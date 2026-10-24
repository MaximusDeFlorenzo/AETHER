import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rainfall Intelligence Milestone 1 (rainfall-intelligence/,
 * docs/RAINFALL_INTELLIGENCE.md): persisted hourly weather per kabupaten/
 * kota reference point, so rainfall accumulations and antecedent
 * conditions are computed from stored history instead of a single
 * on-demand provider call.
 *
 * - `data_kind` records what each value is (model / satellite estimate /
 *   station observation) — only `nwp_model` is ingested today.
 * - Unique (district_id, source, valid_time) makes ingestion idempotent:
 *   overlapping fetch windows upsert, never duplicate.
 */
export class AddWeatherHourlySamples1791330000000 implements MigrationInterface {
  name = 'AddWeatherHourlySamples1791330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "weather_data_kind" AS ENUM ('nwp_model', 'satellite_estimate', 'station_observation')
    `);
    await queryRunner.query(`
      CREATE TABLE "weather_hourly_samples" (
        "id"                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "district_id"                 UUID NOT NULL REFERENCES "districts"(id) ON DELETE CASCADE,
        "source"                      VARCHAR(40) NOT NULL,
        "data_kind"                   weather_data_kind NOT NULL,
        "valid_time"                  TIMESTAMPTZ NOT NULL,
        "latitude"                    NUMERIC(9,6) NOT NULL,
        "longitude"                   NUMERIC(9,6) NOT NULL,
        "grid_elevation_m"            REAL,
        "precipitation_mm"            REAL,
        "wind_speed_10m_kmh"          REAL,
        "wind_from_10m_deg"           REAL,
        "wind_speed_850hpa_kmh"       REAL,
        "wind_from_850hpa_deg"        REAL,
        "wind_speed_700hpa_kmh"       REAL,
        "wind_from_700hpa_deg"        REAL,
        "temperature_c"               REAL,
        "relative_humidity_pct"       REAL,
        "surface_pressure_hpa"        REAL,
        "soil_moisture_9_27cm_m3m3"   REAL,
        "quality_flags"               JSONB NOT NULL DEFAULT '[]',
        "retrieved_at"                TIMESTAMPTZ NOT NULL,
        "created_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_weather_hourly_samples_district_source_time"
          UNIQUE ("district_id", "source", "valid_time")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_weather_hourly_samples_valid_time" ON "weather_hourly_samples"(valid_time)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "weather_hourly_samples"`);
    await queryRunner.query(`DROP TYPE "weather_data_kind"`);
  }
}
