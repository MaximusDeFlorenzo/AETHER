import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The dashboard summary and the recommendation list sort ALL
 * recommendations by priority_score (170k+ rows locally). The existing
 * idx_decision_rec_priority leads with priority_level, so that sort ran as
 * a parallel seq scan + sort — whose shared memory overflowed Docker's
 * default 64 MB /dev/shm and failed /dashboard with a 500. A plain
 * descending index turns it into an index scan with no parallel workers.
 */
export class AddDecisionRecommendationScoreIndex1791440000000 implements MigrationInterface {
  name = 'AddDecisionRecommendationScoreIndex1791440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_decision_rec_priority_score" ON "decision_recommendations" ("priority_score" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_decision_rec_priority_score"`);
  }
}
