import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `flood_details.flood_hazard_index` — a 0-1 hazard-susceptibility
 * value looked up from BNPB's InaRISK `INDEKS_BAHAYA_BANJIR` layer
 * (gis.bnpb.go.id, see `ingestion/adapters/bnpb-inarisk.client.ts`) per
 * event coordinate at ingestion time. Nullable: only PetaBencana-sourced
 * events currently populate it (a lookup failure/NoData coverage gap also
 * leaves it null); `flood.py` treats a missing value as no known
 * contribution, same posture as `rainfall_mm`. See docs/DATABASE_SCHEMA.md
 * §13.
 */
export class AddFloodHazardIndex1786247504185 implements MigrationInterface {
  name = 'AddFloodHazardIndex1786247504185';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "flood_details"
      ADD COLUMN "flood_hazard_index" NUMERIC(4,3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "flood_details"
      DROP COLUMN "flood_hazard_index"
    `);
  }
}
