import type { Repository } from 'typeorm';
import type { Village } from '../../database/entities';
import {
  buildHierarchyKey,
  type VillageIndexEntry,
  type VillageLookup,
} from './row-processor';

/**
 * Loads the full villages table (all ~84k rows, joined up to province) into
 * an in-memory lookup ONCE per validation job run — a few MB, held for the
 * duration of that one job, and explicitly NOT the same thing as holding
 * the uploaded file's rows in memory (that's what streaming avoids). This
 * lookup is read-only per run; a village added mid-run would just be
 * missed until the next run, which is an acceptable tradeoff given
 * `villages` is reference data that changes only via a reseed, never a
 * live write path.
 */
export async function buildVillageLookup(
  villageRepository: Repository<Village>,
): Promise<VillageLookup> {
  const rows: Array<{
    id: string;
    code: string;
    name: string;
    subdistrict_name: string;
    district_name: string;
    province_name: string;
  }> = await villageRepository.query(`
    SELECT v.id, v.code, v.name,
           s.name AS subdistrict_name,
           d.name AS district_name,
           p.name AS province_name
    FROM villages v
    JOIN subdistricts s ON s.id = v.subdistrict_id
    JOIN districts d ON d.id = s.district_id
    JOIN provinces p ON p.id = d.province_id
  `);

  const byCode = new Map<string, VillageIndexEntry>();
  const byHierarchy = new Map<string, VillageIndexEntry[]>();
  for (const row of rows) {
    const entry: VillageIndexEntry = {
      id: row.id,
      code: row.code,
      name: row.name,
      subdistrictName: row.subdistrict_name,
      districtName: row.district_name,
      provinceName: row.province_name,
    };
    byCode.set(row.code, entry);
    const hKey = buildHierarchyKey(
      row.province_name,
      row.district_name,
      row.subdistrict_name,
      row.name,
    );
    const list = byHierarchy.get(hKey) ?? [];
    list.push(entry);
    byHierarchy.set(hKey, list);
  }
  return { byCode, byHierarchy };
}
