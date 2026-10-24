import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  PopulationStatistic,
  Province,
  Subdistrict,
  Village,
  VillagePopulation,
} from '../database/entities';
import { CacheService } from '../redis/cache.service';
import { QuerySubdistrictsDto } from './dto/query-subdistricts.dto';
import { QueryVillagesDto } from './dto/query-villages.dto';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

// District shapes aren't circles and their reference point isn't always
// central — 1.5× the equivalent-circle radius covers most of a kabupaten's
// real extent (checked against FIRMS hotspots in Kalimantan, Oct 2026).
const AREA_REACH_FACTOR = 1.5;

export interface NearbyDistrict {
  id: string;
  name: string;
  bpsCode: string;
  provinceId: string;
  distanceKm: number;
}

// See GeoService.getSubdistrictPopulationAggregate's docstring — this is
// an AGGREGATION RESULT, never the kecamatan's official population.
// `coveredVillages < totalVillages` means partial coverage; the caller
// must show `coveragePercentage`, never present `totalPopulation` as if
// it were complete.
export interface SubdistrictPopulationAggregate {
  subdistrictId: string;
  subdistrictName: string;
  totalVillages: number;
  sourceName: string | null;
  periodStatus: 'confirmed' | 'unknown' | null;
  periodYear: number | null;
  coveredVillages: number;
  // Of `coveredVillages`, how many actually had a non-null
  // total_population (vs. a blank/unavailable figure in the source) —
  // `totalPopulation` below is summed ONLY from these, never treating a
  // blank as zero.
  villagesWithTotalPopulation: number;
  coveragePercentage: number;
  isComplete: boolean;
  totalPopulation: number | null;
  male: number | null;
  female: number | null;
  households: number | null;
  // How many OTHER (source, period) combinations also have some data for
  // this subdistrict besides the one chosen (the one with the most
  // village coverage) — signals that a different aggregate may exist if
  // this one looks wrong, without the caller having to guess.
  otherGroupsAvailable: number;
}

// Provinces/districts are BPS reference data with no write endpoint — they
// only ever change via a reseed, so a long TTL is a safe, simple performance
// win with no invalidation logic needed.
const REFERENCE_DATA_TTL_SECONDS = 60 * 60;

// Renamed from ORION's `population/` module — same reference-data + spatial
// lookup responsibilities, generalized so any hazard-events consumer
// (not just earthquakes) can resolve nearby districts.
@Injectable()
export class GeoService {
  constructor(
    @InjectRepository(Province)
    private readonly provinceRepository: Repository<Province>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(Subdistrict)
    private readonly subdistrictRepository: Repository<Subdistrict>,
    @InjectRepository(Village)
    private readonly villageRepository: Repository<Village>,
    @InjectRepository(PopulationStatistic)
    private readonly populationStatisticRepository: Repository<PopulationStatistic>,
    @InjectRepository(VillagePopulation)
    private readonly villagePopulationRepository: Repository<VillagePopulation>,
    private readonly cache: CacheService,
  ) {}

  findAllProvinces(): Promise<Province[]> {
    return this.cache.getOrSet(
      'provinces:all',
      REFERENCE_DATA_TTL_SECONDS,
      () => this.provinceRepository.find({ order: { name: 'ASC' } }),
    );
  }

  findDistricts(provinceId?: string): Promise<District[]> {
    return this.cache.getOrSet(
      `districts:${provinceId ?? 'all'}`,
      REFERENCE_DATA_TTL_SECONDS,
      () =>
        this.districtRepository.find({
          where: provinceId ? { province: { id: provinceId } } : {},
          relations: { province: true },
          order: { name: 'ASC' },
        }),
    );
  }

  async findDistrictOrThrow(districtId: string): Promise<District> {
    const district = await this.districtRepository.findOne({
      where: { id: districtId },
      relations: { province: true },
    });
    if (!district) {
      throw new NotFoundException('District not found');
    }
    return district;
  }

  findAllDistrictsRaw(): Promise<District[]> {
    return this.districtRepository.find();
  }

  async getLatestPopulation(districtId: string): Promise<PopulationStatistic> {
    const stat = await this.populationStatisticRepository.findOne({
      where: { district: { id: districtId } },
      relations: { district: true },
      order: { year: 'DESC' },
    });
    if (!stat) {
      throw new NotFoundException(
        'No population statistics found for this district',
      );
    }
    return stat;
  }

  getPopulationHistory(districtId: string): Promise<PopulationStatistic[]> {
    return this.populationStatisticRepository.find({
      where: { district: { id: districtId } },
      order: { year: 'DESC' },
    });
  }

  /**
   * Resolves districts within `radiusMeters` of a point, nearest-first.
   * Kept decoupled from HazardEvent (callers pass a raw lat/lon) so this
   * module has no reverse dependency — generalizes ORION's
   * `findNearbyDistricts`, previously earthquake-only.
   */
  async findNearbyDistricts(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<NearbyDistrict[]> {
    // Raw `.query()` results bypass entity column transformers, so the
    // numeric `distanceKm` comes back as a string from the pg driver —
    // parsed explicitly here for the same reason numericTransformer exists
    // on entities.
    const rows: Array<
      Omit<NearbyDistrict, 'distanceKm'> & { distanceKm: string }
    > = await this.districtRepository.query(
      `
      SELECT
        d.id AS "id",
        d.name AS "name",
        d.bps_code AS "bpsCode",
        d.province_id AS "provinceId",
        ST_Distance(d.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 AS "distanceKm"
      FROM districts d
      WHERE ST_DWithin(d.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY "distanceKm" ASC
      `,
      [latitude, longitude, radiusMeters],
    );

    return rows.map((row) => ({
      ...row,
      distanceKm: Number.parseFloat(row.distanceKm),
    }));
  }

  /**
   * Area-aware variant of `findNearbyDistricts` for hazard → district
   * resolution. Districts are stored as a single reference point, so a
   * fixed radius silently drops events deep inside large kabupaten (a
   * hotspot 80 km from Barito Utara's point is still Barito Utara). Each
   * district's reach is therefore the larger of the hazard radius and
   * `AREA_REACH_FACTOR` × its equivalent-circle radius — area estimated as
   * latest population ÷ density — capped at `maxReachMeters`. An
   * approximation until real boundary polygons are imported; border events
   * can resolve to every neighbour whose reach covers them.
   */
  async findDistrictsReachingPoint(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    maxReachMeters = 150_000,
  ): Promise<NearbyDistrict[]> {
    const rows: Array<
      Omit<NearbyDistrict, 'distanceKm'> & { distanceKm: string }
    > = await this.districtRepository.query(
      `
      WITH pop AS (
        SELECT DISTINCT ON (district_id)
          district_id,
          total_population::float AS tp,
          population_density::float AS pd
        FROM population_statistics
        ORDER BY district_id, year DESC
      ),
      candidates AS (
        SELECT
          d.id, d.name, d.bps_code, d.province_id,
          ST_Distance(d.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS dist_m,
          GREATEST(
            $3::float,
            LEAST(
              $4::float,
              COALESCE($5::float * sqrt(p.tp / NULLIF(p.pd, 0) / pi()) * 1000, 0)
            )
          ) AS reach_m
        FROM districts d
        LEFT JOIN pop p ON p.district_id = d.id
        WHERE ST_DWithin(d.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, GREATEST($3::float, $4::float))
      )
      SELECT
        id AS "id",
        name AS "name",
        bps_code AS "bpsCode",
        province_id AS "provinceId",
        dist_m / 1000 AS "distanceKm"
      FROM candidates
      WHERE dist_m <= reach_m
      ORDER BY dist_m ASC
      `,
      [latitude, longitude, radiusMeters, maxReachMeters, AREA_REACH_FACTOR],
    );

    return rows.map((row) => ({
      ...row,
      distanceKm: Number.parseFloat(row.distanceKm),
    }));
  }

  /**
   * Kecamatan, scoped by parent district and/or name search, paginated —
   * never returns the full 7,285-row table at once (per docs/DATABASE_SCHEMA.md
   * §7: query by parent, search or pagination, never a full dump).
   */
  async findSubdistricts(
    query: QuerySubdistrictsDto,
  ): Promise<Paginated<Subdistrict>> {
    const qb = this.subdistrictRepository
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.district', 'district')
      .orderBy('s.name', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.district) {
      qb.andWhere('district.id = :districtId', { districtId: query.district });
    }
    if (query.search) {
      qb.andWhere('s.name ILIKE :search', { search: `%${query.search}%` });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async findSubdistrictOrThrow(id: string): Promise<Subdistrict> {
    const subdistrict = await this.subdistrictRepository.findOne({
      where: { id },
      relations: { district: { province: true } },
    });
    if (!subdistrict) {
      throw new NotFoundException('Subdistrict not found');
    }
    return subdistrict;
  }

  /**
   * Kelurahan/desa, scoped by parent subdistrict and/or name search,
   * paginated — never returns the full 83,762-row table at once, same
   * rationale as `findSubdistricts`.
   */
  async findVillages(query: QueryVillagesDto): Promise<Paginated<Village>> {
    const qb = this.villageRepository
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.subdistrict', 'subdistrict')
      .orderBy('v.name', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.subdistrict) {
      qb.andWhere('subdistrict.id = :subdistrictId', {
        subdistrictId: query.subdistrict,
      });
    }
    if (query.search) {
      qb.andWhere('v.name ILIKE :search', { search: `%${query.search}%` });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async findVillageOrThrow(id: string): Promise<Village> {
    const village = await this.villageRepository.findOne({
      where: { id },
      relations: { subdistrict: { district: { province: true } } },
    });
    if (!village) {
      throw new NotFoundException('Village not found');
    }
    return village;
  }

  /**
   * Every imported population record for a village (CSV-import module
   * writes these — see village-population-import.service.ts), newest
   * first, preferring a confirmed statistical period over an unknown one
   * at the same recency. Returns `[]` (not a 404) when nothing has been
   * imported yet — "no data imported" is a normal, expected state here,
   * not an error, since this endpoint's whole purpose is to let /regions
   * show "belum ada data" explicitly rather than assuming import always
   * happened.
   */
  getVillagePopulations(villageId: string): Promise<VillagePopulation[]> {
    return this.villagePopulationRepository.find({
      where: { village: { id: villageId } },
      order: {
        periodStatus: 'ASC', // 'confirmed' sorts before 'unknown' alphabetically
        periodYear: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  /**
   * SUMS village-level population up to the kecamatan it belongs to — the
   * one place in this codebase that aggregates `village_populations`
   * upward, built per docs/DATABASE_SCHEMA.md §6c-6e's explicit rule:
   * "jika dihitung dari data desa/kelurahan, labeli sebagai hasil
   * agregasi ... lengkap hanya jika setiap wilayah anak tercakup, tidak
   * terduplikasi, dan periode/definisi kompatibel ... jika parsial,
   * tunjukkan subtotal yang tercakup dan persentase coverage-nya — jangan
   * pernah menyebutnya sebagai total populasi kecamatan tersebut."
   *
   * Never mixes periods/sources into one sum: groups every village's
   * population rows by the exact (source_name, period_status,
   * period_year) triple first, and only sums WITHIN the group with the
   * most village coverage (ties broken by the most recent period_year) —
   * picking that one automatically rather than asking the caller to
   * specify, since in practice only one import source/period is current
   * for a given area at a time. `isComplete` is true only when every
   * village under the subdistrict has a row in that exact group; a NULL
   * `total_population` on an individual village (blank in the source, not
   * a real zero) is never treated as zero — `villagesWithTotalPopulation`
   * tracks this honestly instead of letting SQL's SUM() silently skip it
   * and look identical to full coverage.
   */
  async getSubdistrictPopulationAggregate(
    subdistrictId: string,
  ): Promise<SubdistrictPopulationAggregate> {
    const subdistrict = await this.findSubdistrictOrThrow(subdistrictId);

    const totalVillages = await this.villageRepository.count({
      where: { subdistrict: { id: subdistrictId } },
    });

    const groups: Array<{
      source_name: string;
      period_status: 'confirmed' | 'unknown';
      period_year: number | null;
      covered_villages: string;
      villages_with_total_population: string;
      total_population: string | null;
      male: string | null;
      female: string | null;
      households: string | null;
    }> = await this.villagePopulationRepository.query(
      `
      SELECT
        vp.source_name,
        vp.period_status,
        vp.period_year,
        COUNT(DISTINCT vp.village_id) AS covered_villages,
        COUNT(DISTINCT vp.village_id) FILTER (WHERE vp.total_population IS NOT NULL)
          AS villages_with_total_population,
        SUM(vp.total_population) AS total_population,
        SUM(vp.male) AS male,
        SUM(vp.female) AS female,
        SUM(vp.households) AS households
      FROM village_populations vp
      JOIN villages v ON v.id = vp.village_id
      WHERE v.subdistrict_id = $1
      GROUP BY vp.source_name, vp.period_status, vp.period_year
      ORDER BY covered_villages DESC, vp.period_year DESC NULLS LAST
      `,
      [subdistrictId],
    );

    const best = groups[0] ?? null;
    const coveredVillages = best ? Number(best.covered_villages) : 0;

    return {
      subdistrictId,
      subdistrictName: subdistrict.name,
      totalVillages,
      sourceName: best?.source_name ?? null,
      periodStatus: best?.period_status ?? null,
      periodYear: best?.period_year ?? null,
      coveredVillages,
      villagesWithTotalPopulation: best
        ? Number(best.villages_with_total_population)
        : 0,
      coveragePercentage:
        totalVillages > 0
          ? Math.round((coveredVillages / totalVillages) * 1000) / 10
          : 0,
      isComplete: totalVillages > 0 && coveredVillages === totalVillages,
      totalPopulation:
        best && Number(best.villages_with_total_population) > 0
          ? Number(best.total_population)
          : null,
      male: best && best.male !== null ? Number(best.male) : null,
      female: best && best.female !== null ? Number(best.female) : null,
      households:
        best && best.households !== null ? Number(best.households) : null,
      otherGroupsAvailable: Math.max(0, groups.length - 1),
    };
  }

  /**
   * District centroid lat/lon — used by baseline/standing risk scoring
   * (`RiskEngineOrchestrationService`) to synthesize a `HazardEventInput`
   * for a district with no concrete triggering event.
   */
  async getDistrictCentroid(
    districtId: string,
  ): Promise<{ latitude: number; longitude: number }> {
    const rows: Array<{ latitude: string; longitude: string }> =
      await this.districtRepository.query(
        `SELECT ST_Y(ST_Centroid(geom)) AS latitude, ST_X(ST_Centroid(geom)) AS longitude
         FROM districts WHERE id = $1`,
        [districtId],
      );
    if (!rows[0]) {
      throw new NotFoundException('District not found');
    }
    return {
      latitude: Number.parseFloat(rows[0].latitude),
      longitude: Number.parseFloat(rows[0].longitude),
    };
  }
}
