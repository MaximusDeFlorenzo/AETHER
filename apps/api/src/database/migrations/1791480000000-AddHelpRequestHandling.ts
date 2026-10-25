import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Officer progress on a citizen's "Butuh bantuan" request: dispatched
 * ("petugas sedang dikerahkan") and resolved ("sudah aman / dievakuasi"), so
 * the dashboard's red badge only counts people nobody has acted on yet.
 */
export class AddHelpRequestHandling1791480000000 implements MigrationInterface {
  name = 'AddHelpRequestHandling1791480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public_alert_responses"
        ADD COLUMN "handling" varchar(20)
          CHECK ("handling" IN ('dispatched', 'resolved')),
        ADD COLUMN "handled_at" timestamptz,
        ADD COLUMN "handled_by_id" uuid
          REFERENCES "users" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public_alert_responses"
        DROP COLUMN "handled_by_id",
        DROP COLUMN "handled_at",
        DROP COLUMN "handling"
    `);
  }
}
