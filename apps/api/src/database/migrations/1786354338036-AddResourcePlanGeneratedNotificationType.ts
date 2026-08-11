import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `resource_plan_generated` to the `notification_type` enum so
 * NotificationsService can notify on DomainEvents.RESOURCE_PLAN_GENERATED
 * (previously emitted with no listener) the same way it already does for
 * DECISION_RECOMMENDATION_CREATED etc.
 */
export class AddResourcePlanGeneratedNotificationType1786354338036 implements MigrationInterface {
  name = 'AddResourcePlanGeneratedNotificationType1786354338036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "notification_type" ADD VALUE 'resource_plan_generated'
    `);
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums; downgrading would require
    // recreating the type. Left as a no-op, consistent with the additive
    // nature of this change (no existing rows use the new value to remove).
  }
}
