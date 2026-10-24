import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kelurahan/desa reference points (polygon centroids), seeded by
 * seeds/seed-village-centroids.ts — lets an event's affected population be
 * summed per kelurahan within its hazard radius instead of per
 * kabupaten/kota. Nullable: a handful of villages have no centroid in the
 * source. Indexed as geography since every lookup is a metre-radius
 * ST_DWithin.
 */
export class AddVillageCentroids1791430000000 implements MigrationInterface {
  name = 'AddVillageCentroids1791430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "villages" ADD "geom" geometry(Point,4326)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_villages_geog" ON "villages" USING GIST (("geom"::geography))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_villages_geog"`);
    await queryRunner.query(`ALTER TABLE "villages" DROP COLUMN "geom"`);
  }
}
