import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Officer-managed posko and titik kumpul (Operations › Posko & Titik
 * Kumpul): a kind, contact and address details shown to citizens, and an
 * active flag so a closed site disappears from the citizen portal without
 * losing its history.
 */
export class AddShelterManagementFields1791450000000 implements MigrationInterface {
  name = 'AddShelterManagementFields1791450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shelters"
        ADD COLUMN "kind" varchar(20) NOT NULL DEFAULT 'posko'
          CHECK ("kind" IN ('posko', 'assembly_point')),
        ADD COLUMN "address" varchar(300),
        ADD COLUMN "contact_name" varchar(120),
        ADD COLUMN "contact_phone" varchar(40),
        ADD COLUMN "notes" text,
        ADD COLUMN "is_active" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shelters"
        DROP COLUMN "is_active",
        DROP COLUMN "notes",
        DROP COLUMN "contact_phone",
        DROP COLUMN "contact_name",
        DROP COLUMN "address",
        DROP COLUMN "kind"
    `);
  }
}
