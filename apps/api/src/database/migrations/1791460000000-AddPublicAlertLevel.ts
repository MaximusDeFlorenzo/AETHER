import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BNPB status level on citizen alarms (Waspada / Siaga / Awas), so an
 * officer's Siaga order shows an orange screen rather than Awas red. Alarms
 * issued before this existed were all shown red, hence the 'awas' default.
 */
export class AddPublicAlertLevel1791460000000 implements MigrationInterface {
  name = 'AddPublicAlertLevel1791460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public_alert_level" AS ENUM ('waspada', 'siaga', 'awas')`,
    );
    await queryRunner.query(`
      ALTER TABLE "public_alerts"
        ADD COLUMN "level" "public_alert_level" NOT NULL DEFAULT 'awas'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "public_alerts" DROP COLUMN "level"`);
    await queryRunner.query(`DROP TYPE "public_alert_level"`);
  }
}
