import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NASA FIRMS (MODIS + VIIRS) adds ~12k wildfire hazard events a day; the
 * public hotspot map and the karhutla pipeline both read "this source,
 * last N hours", which the separate hazard_type / event_time indexes serve
 * poorly once the table holds months of detections.
 */
export class AddHazardEventSourceTimeIndex1791410000000 implements MigrationInterface {
  name = 'AddHazardEventSourceTimeIndex1791410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_hazard_events_source_event_time" ON "hazard_events" ("source", "event_time" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_hazard_events_source_event_time"`);
  }
}
