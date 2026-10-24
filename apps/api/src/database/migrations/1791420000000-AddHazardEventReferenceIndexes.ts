import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The FIRMS hotspot retention job (ingestion/hotspot-retention.service.ts)
 * keeps any detection still referenced elsewhere and deletes the rest —
 * every referencing FK cascades, so both the "still referenced?" check and
 * the cascade itself look these columns up per deleted row. The other
 * referencing columns are already indexed.
 */
export class AddHazardEventReferenceIndexes1791420000000 implements MigrationInterface {
  name = 'AddHazardEventReferenceIndexes1791420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_related_hazard_event" ON "notifications" ("related_hazard_event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_public_alerts_hazard_event" ON "public_alerts" ("hazard_event_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_public_alerts_hazard_event"`);
    await queryRunner.query(
      `DROP INDEX "idx_notifications_related_hazard_event"`,
    );
  }
}
