import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Butuh bantuan" answers can carry optional details for the rescue team
 * (how many people, their situation, a phone number), and officers get a
 * dashboard notification for each new help request.
 */
export class AddHelpRequestDetails1791470000000 implements MigrationInterface {
  name = 'AddHelpRequestDetails1791470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public_alert_responses"
        ADD COLUMN "people_count" smallint,
        ADD COLUMN "note" varchar(300),
        ADD COLUMN "contact_phone" varchar(30)
    `);
    await queryRunner.query(`
      ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'citizen_help_request'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public_alert_responses"
        DROP COLUMN "contact_phone",
        DROP COLUMN "note",
        DROP COLUMN "people_count"
    `);
    // Postgres has no DROP VALUE for enums; 'citizen_help_request' stays.
  }
}
