/**
 * Imports kecamatan (`subdistricts`) and kelurahan/desa (`villages`) — real
 * code/name data from `data/indonesia-subdistricts.json` /
 * `data/indonesia-villages.json`, both generated 2026-09-22 by parsing
 * github.com/cahyadsn/wilayah's `db/wilayah.sql` (Kepmendagri No
 * 300.2.2-2138 Tahun 2025) with a SQL-string-escape-aware parser (a naive
 * regex first pass silently dropped 437 rows whose names contain an
 * apostrophe, e.g. "Ma'u" in Nias — re-parsed correctly before these JSON
 * files were committed; see git history of this file for the fix).
 *
 * Deliberately requires `districts` to already be seeded (FK's off it) —
 * run after `seedReferenceData`. Deliberately does NOT import population,
 * area or coordinates for either level: no verified source provides them
 * (see subdistrict.entity.ts / village.entity.ts's comments).
 *
 * Idempotent via `ON CONFLICT (code) DO NOTHING` — safe to re-run; reports
 * inserted vs already-present (duplicate) counts from each batch's returned
 * identifier count rather than a pre-check `SELECT`, since a 91k-row
 * existence pre-check would be far slower than letting Postgres do it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource, ObjectLiteral } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { District, Subdistrict, Village } from '../entities';

const BATCH_SIZE = 5000;

interface SubdistrictRecord {
  code: string;
  name: string;
  districtCode: string;
}

interface VillageRecord {
  code: string;
  name: string;
  subdistrictCode: string;
}

function loadJson<T>(filename: string): T {
  const path = join(__dirname, 'data', filename);
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

async function insertInBatches<T extends ObjectLiteral>(
  dataSource: DataSource,
  entity: new () => T,
  rows: QueryDeepPartialEntity<T>[],
): Promise<{ inserted: number; duplicate: number }> {
  const repo = dataSource.getRepository(entity);
  // Ground truth via row count before/after, not `InsertResult.identifiers`
  // — verified empirically (two full seed runs against a live Postgres)
  // that TypeORM's Postgres query builder reports one identifier per input
  // row here regardless of whether `ON CONFLICT DO NOTHING` actually
  // inserted or skipped it, which would have overcounted "inserted" on
  // every re-run despite the DB itself staying correctly deduplicated.
  const before = await repo.count();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await dataSource
      .createQueryBuilder()
      .insert()
      .into(entity)
      .values(batch)
      .orIgnore()
      .execute();
  }
  const after = await repo.count();
  const inserted = after - before;
  return { inserted, duplicate: rows.length - inserted };
}

export async function seedSubdistrictsAndVillages(
  dataSource: DataSource,
): Promise<void> {
  const districtRepo = dataSource.getRepository(District);
  const subdistrictRepo = dataSource.getRepository(Subdistrict);

  // --- Kecamatan --------------------------------------------------------
  const subdistrictRecords = loadJson<SubdistrictRecord[]>(
    'indonesia-subdistricts.json',
  );

  const districts = await districtRepo.find({ select: ['id', 'bpsCode'] });
  const districtIdByCode = new Map(districts.map((d) => [d.bpsCode, d.id]));

  const subdistrictRows: Array<{
    district: { id: string };
    code: string;
    name: string;
  }> = [];
  const unmappedSubdistricts: SubdistrictRecord[] = [];
  for (const record of subdistrictRecords) {
    const districtId = districtIdByCode.get(record.districtCode);
    if (!districtId) {
      unmappedSubdistricts.push(record);
      continue;
    }
    subdistrictRows.push({
      district: { id: districtId },
      code: record.code,
      name: record.name,
    });
  }

  const subdistrictResult = await insertInBatches(
    dataSource,
    Subdistrict,
    subdistrictRows,
  );

  console.log(
    `Subdistricts (kecamatan): ${subdistrictRecords.length} in source, ` +
      `${subdistrictResult.inserted} inserted, ${subdistrictResult.duplicate} already present, ` +
      `${unmappedSubdistricts.length} unmapped (parent district not found)`,
  );
  if (unmappedSubdistricts.length > 0) {
    console.warn(
      'Unmapped subdistricts (parent districtCode not in districts table):',
      unmappedSubdistricts.slice(0, 20),
    );
  }

  // --- Kelurahan/desa -----------------------------------------------------
  const villageRecords = loadJson<VillageRecord[]>('indonesia-villages.json');

  const subdistricts = await subdistrictRepo.find({ select: ['id', 'code'] });
  const subdistrictIdByCode = new Map(subdistricts.map((s) => [s.code, s.id]));

  const villageRows: Array<{
    subdistrict: { id: string };
    code: string;
    name: string;
  }> = [];
  const unmappedVillages: VillageRecord[] = [];
  for (const record of villageRecords) {
    const subdistrictId = subdistrictIdByCode.get(record.subdistrictCode);
    if (!subdistrictId) {
      unmappedVillages.push(record);
      continue;
    }
    villageRows.push({
      subdistrict: { id: subdistrictId },
      code: record.code,
      name: record.name,
    });
  }

  const villageResult = await insertInBatches(dataSource, Village, villageRows);

  console.log(
    `Villages (kelurahan/desa): ${villageRecords.length} in source, ` +
      `${villageResult.inserted} inserted, ${villageResult.duplicate} already present, ` +
      `${unmappedVillages.length} unmapped (parent subdistrict not found)`,
  );
  if (unmappedVillages.length > 0) {
    console.warn(
      'Unmapped villages (parent subdistrictCode not in subdistricts table):',
      unmappedVillages.slice(0, 20),
    );
  }
}
