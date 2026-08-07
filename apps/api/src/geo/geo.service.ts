import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { District, PopulationStatistic, Province } from '../database/entities';
import { CacheService } from '../redis/cache.service';

export interface NearbyDistrict {
  id: string;
  name: string;
  bpsCode: string;
  provinceId: string;
  distanceKm: number;
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
    @InjectRepository(PopulationStatistic)
    private readonly populationStatisticRepository: Repository<PopulationStatistic>,
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
