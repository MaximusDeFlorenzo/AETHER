/**
 * Fills `villages.geom` with each kelurahan/desa's reference point from
 * `data/indonesia-village-centroids.json` — `[code, lat, lng]` rows
 * generated 2026-10-23 from github.com/cahyadsn/wilayah_boundaries (MIT,
 * Kepmendagri No 300.2.2-2430 Tahun 2025, commit 68e93c0) `db/kel/**`: the
 * centroid of each village polygon, rounded to 5 decimals (~1 m). Matched
 * by Kemendagri code — 83,578 of the 83,762 seeded villages; the rest have
 * no polygon upstream yet and keep a NULL geom.
 *
 * Run after seedSubdistrictsAndVillages. Idempotent: a plain UPDATE by
 * code, safe to re-run when the data file is refreshed.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';

const BATCH_SIZE = 5000;

type CentroidRecord = [code: string, lat: number, lng: number];

export async function seedVillageCentroids(
  dataSource: DataSource,
): Promise<void> {
  const rows = JSON.parse(
    readFileSync(
      join(__dirname, 'data', 'indonesia-village-centroids.json'),
      'utf-8',
    ),
  ) as CentroidRecord[];

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result: [unknown[], number] = await dataSource.query(
      `UPDATE villages v
       SET geom = ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)
       FROM unnest($1::varchar[], $2::float8[], $3::float8[]) AS c(code, lat, lng)
       WHERE v.code = c.code`,
      [batch.map((r) => r[0]), batch.map((r) => r[1]), batch.map((r) => r[2])],
    );
    updated += result[1];
  }
  console.log(
    `Village centroids: ${updated} of ${rows.length} source points matched a seeded village.`,
  );
}
