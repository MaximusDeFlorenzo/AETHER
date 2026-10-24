import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { HazardType } from '../common/enums/domain.enum';
import {
  DomainEvents,
  type HazardEventCreatedEvent,
} from '../common/events/domain-events';
import { District, HazardEvent } from '../database/entities';
import { haversineKm } from '../karhutla-prediction/lib/geo';
import { CacheService } from '../redis/cache.service';
import {
  buildHotspotMap,
  eligibleHotspots,
  toMapPoint,
  type DistrictPoint,
  type HotspotMap,
  type MapCluster,
  type MapPoint,
} from './hotspot-map';

const FIRMS_SOURCE = 'nasa_firms';
const CACHE_PREFIX = 'public:hotspots:';
const CACHE_TTL_SECONDS = 300;
// Clusters this close to the citizen are always returned, whatever their
// rank — "Dekat wilayah Anda" must not depend on a fire being large.
export const NEAR_RADIUS_KM = 150;
export const MAX_POINTS = 3000;

export type PublicHotspotMap = Omit<HotspotMap, 'clusters'> & {
  clusters: Array<Omit<MapCluster, 'hotspotEventIds'>>;
  truncated: boolean;
};

export interface HotspotMapQuery {
  hours: number;
  limit: number;
  near?: { latitude: number; longitude: number };
}

/**
 * Public FIRMS hotspot map: the full clustered window is computed once and
 * cached (5 min, dropped early when a new fire cluster is announced); each
 * request then just trims it to the strongest `limit` clusters plus any
 * near the citizen.
 */
@Injectable()
export class HotspotMapService {
  constructor(
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    private readonly cache: CacheService,
  ) {}

  async getMap(query: HotspotMapQuery): Promise<PublicHotspotMap> {
    const map = await this.getFullMap(query.hours);
    const near = query.near;
    const clusters = map.clusters.filter(
      (cluster, index) =>
        index < query.limit ||
        (near !== undefined &&
          haversineKm(
            near.latitude,
            near.longitude,
            cluster.latitude,
            cluster.longitude,
          ) <= NEAR_RADIUS_KM),
    );
    return {
      ...map,
      // Event ids stay server-side (smoke matching); ~36 bytes per
      // detection would triple the payload.
      clusters: clusters.map(({ hotspotEventIds: _ids, ...rest }) => rest),
      truncated: clusters.length < map.clusters.length,
    };
  }

  /** Every cluster in the window, event ids included — cached. */
  getFullMap(hours: number): Promise<HotspotMap> {
    return this.cache.getOrSet(
      `${CACHE_PREFIX}${hours}`,
      CACHE_TTL_SECONDS,
      () => this.computeMap(hours),
    );
  }

  /** Individual detections inside a viewport, newest first. */
  async getPoints(
    hours: number,
    bbox: [number, number, number, number],
  ): Promise<{ points: MapPoint[]; truncated: boolean }> {
    const [west, south, east, north] = bbox;
    const rows = await this.hazardEventRepository
      .createQueryBuilder('e')
      .select([
        'e.id',
        'e.latitude',
        'e.longitude',
        'e.eventTime',
        'e.externalId',
        'e.rawPayload',
      ])
      .where('e.source = :source', { source: FIRMS_SOURCE })
      .andWhere('e.eventTime >= :from', { from: this.windowStart(hours) })
      .andWhere(
        'e.geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)',
        { west, south, east, north },
      )
      .orderBy('e.eventTime', 'DESC')
      .limit(MAX_POINTS + 1)
      .getMany();
    const { eligible } = eligibleHotspots(rows.slice(0, MAX_POINTS));
    return {
      points: eligible.map(toMapPoint),
      truncated: rows.length > MAX_POINTS,
    };
  }

  @OnEvent(DomainEvents.HAZARD_EVENT_CREATED, { async: true })
  async onHazardEventCreated(event: HazardEventCreatedEvent): Promise<void> {
    if (event.hazardType !== HazardType.WILDFIRE) return;
    await this.cache.invalidatePattern(`${CACHE_PREFIX}*`);
  }

  private windowStart(hours: number): Date {
    return new Date(Date.now() - hours * 3_600_000);
  }

  private async computeMap(hours: number): Promise<HotspotMap> {
    const to = new Date();
    const from = this.windowStart(hours);
    const [rows, districts] = await Promise.all([
      this.hazardEventRepository.find({
        where: { source: FIRMS_SOURCE, eventTime: MoreThanOrEqual(from) },
        select: {
          id: true,
          latitude: true,
          longitude: true,
          eventTime: true,
          externalId: true,
          rawPayload: true,
        },
      }),
      this.loadDistricts(),
    ]);
    return buildHotspotMap(rows, districts, { from, to, hours });
  }

  private async loadDistricts(): Promise<DistrictPoint[]> {
    const districts = await this.districtRepository.find({
      relations: { province: true },
    });
    return districts.flatMap((d) => {
      const geom = d.geom as {
        type?: string;
        coordinates?: [number, number];
      } | null;
      if (geom?.type !== 'Point' || !geom.coordinates) return [];
      const [longitude, latitude] = geom.coordinates;
      return [
        {
          id: d.id,
          name: d.name,
          provinceName: d.province?.name ?? null,
          latitude,
          longitude,
        },
      ];
    });
  }
}
