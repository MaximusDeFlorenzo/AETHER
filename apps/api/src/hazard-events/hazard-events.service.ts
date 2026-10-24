import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import {
  EarthquakeDetails,
  FloodDetails,
  HazardEvent,
  LandslideDetails,
  WildfireDetails,
} from '../database/entities';
import { HazardType } from '../common/enums/domain.enum';
import { SpatialIntelligenceService } from '../spatial-intelligence/spatial-intelligence.service';
import { GeoService } from '../geo/geo.service';
import { DomainEvents } from '../common/events/domain-events';
import type { HazardEventCreatedEvent } from '../common/events/domain-events';
import type {
  IngestedHazardEvent,
  NormalizedHazardEvent,
} from './hazard-event-normalized.interface';
import {
  EarthquakeDetailsShape,
  validateEarthquakeDetails,
} from './earthquake/earthquake-details.shape';
import {
  LandslideDetailsShape,
  validateLandslideDetails,
} from './landslide/landslide-details.shape';
import {
  FloodDetailsShape,
  validateFloodDetails,
} from './flood/flood-details.shape';
import {
  WildfireDetailsShape,
  validateWildfireDetails,
} from './wildfire/wildfire-details.shape';

// Real Indonesian seismic zones covered by database/seeds/reference-data.seed.ts
// districts, so a simulated epicenter reliably resolves affected districts
// (spatial-intelligence.service.ts's resolveAffectedRegions) instead of
// landing somewhere the seed data doesn't cover.
const SIMULATED_EARTHQUAKE_EPICENTERS: Array<{
  label: string;
  region: string;
  latitude: number;
  longitude: number;
}> = [
  {
    label: 'Yogyakarta',
    region: 'D.I. Yogyakarta',
    latitude: -7.8,
    longitude: 110.36,
  },
  {
    label: 'Padang',
    region: 'Sumatera Barat',
    latitude: -0.95,
    longitude: 100.42,
  },
  {
    label: 'Lombok',
    region: 'Nusa Tenggara Barat',
    latitude: -8.62,
    longitude: 116.3,
  },
  {
    label: 'Palu',
    region: 'Sulawesi Tengah',
    latitude: -0.89,
    longitude: 119.87,
  },
];

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

@Injectable()
export class HazardEventsService {
  private readonly logger = new Logger(HazardEventsService.name);

  constructor(
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectRepository(EarthquakeDetails)
    private readonly earthquakeDetailsRepository: Repository<EarthquakeDetails>,
    @InjectRepository(LandslideDetails)
    private readonly landslideDetailsRepository: Repository<LandslideDetails>,
    @InjectRepository(FloodDetails)
    private readonly floodDetailsRepository: Repository<FloodDetails>,
    @InjectRepository(WildfireDetails)
    private readonly wildfireDetailsRepository: Repository<WildfireDetails>,
    private readonly spatialIntelligenceService: SpatialIntelligenceService,
    private readonly geoService: GeoService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(filters: {
    hazardType?: HazardType;
    minSeverity?: number;
    from?: string;
    to?: string;
    province?: string;
    page: number;
    limit: number;
  }) {
    const qb = this.hazardEventRepository
      .createQueryBuilder('event')
      .orderBy('event.eventTime', 'DESC');

    if (filters.hazardType) {
      qb.andWhere('event.hazardType = :hazardType', {
        hazardType: filters.hazardType,
      });
    }
    if (filters.from) {
      qb.andWhere('event.eventTime >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('event.eventTime <= :to', { to: filters.to });
    }
    if (filters.province) {
      qb.andWhere(
        `event.id IN (
          SELECT har.hazard_event_id FROM hazard_affected_regions har
          JOIN districts d ON d.id = har.district_id
          WHERE d.province_id = :province
        )`,
        { province: filters.province },
      );
    }
    // minSeverity only has a defined meaning for hazard types with a single
    // dominant scalar severity field — earthquake (magnitude), flood (water
    // level in meters), wildfire (FIRMS frp confidence, 0-1). Landslide has
    // no single such field and always passes through unfiltered. Applied as
    // a post-filter EXISTS rather than complicating the base query.
    if (filters.minSeverity !== undefined) {
      qb.andWhere(
        `(
          event.hazardType NOT IN ('earthquake', 'flood', 'wildfire')
          OR (event.hazardType = 'earthquake' AND EXISTS (
            SELECT 1 FROM earthquake_details ed
            WHERE ed.hazard_event_id = event.id AND ed.magnitude >= :minSeverity
          ))
          OR (event.hazardType = 'flood' AND EXISTS (
            SELECT 1 FROM flood_details fd
            WHERE fd.hazard_event_id = event.id AND fd.water_level_m >= :minSeverity
          ))
          OR (event.hazardType = 'wildfire' AND EXISTS (
            SELECT 1 FROM wildfire_details wd
            WHERE wd.hazard_event_id = event.id AND wd.frp_confidence >= :minSeverity
          ))
        )`,
        { minSeverity: filters.minSeverity },
      );
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    const withDetails = await this.attachDetails(data);

    return {
      data: withDetails,
      meta: { page: filters.page, limit: filters.limit, total },
    };
  }

  async findOne(id: string): Promise<
    HazardEvent & {
      details: Record<string, unknown> | null;
      affectedRegionCount: number;
    }
  > {
    const event = await this.hazardEventRepository.findOne({ where: { id } });
    if (!event) {
      throw new NotFoundException('Hazard event not found');
    }
    const [withDetails] = await this.attachDetails([event]);
    return withDetails;
  }

  findRelationships(hazardEventId: string) {
    return this.spatialIntelligenceService.findRelationshipsForEvent(
      hazardEventId,
    );
  }

  async findAffectedRegions(hazardEventId: string) {
    const event = await this.hazardEventRepository.findOne({
      where: { id: hazardEventId },
    });
    if (!event) {
      throw new NotFoundException('Hazard event not found');
    }
    return this.spatialIntelligenceService.findAffectedRegionsForEvent(
      hazardEventId,
    );
  }

  async findAffectedPopulation(hazardEventId: string) {
    const event = await this.hazardEventRepository.findOne({
      where: { id: hazardEventId },
    });
    if (!event) {
      throw new NotFoundException('Hazard event not found');
    }
    // Same radius as the event's affected districts: magnitude-derived for
    // earthquakes, fixed per hazard type otherwise.
    const quake =
      event.hazardType === HazardType.EARTHQUAKE
        ? await this.earthquakeDetailsRepository.findOneBy({ hazardEventId })
        : null;
    return this.spatialIntelligenceService.estimateAffectedPopulation(
      event,
      quake?.magnitude ?? null,
    );
  }

  /** Manual/ground-truth ingestion path (field_reporter role, or an
   * admin/agency_operator override) — reuses the same validate -> dedupe ->
   * persist -> resolve-regions -> detect-relationships -> emit pipeline as
   * adapter-sourced events. */
  async createManual(input: {
    hazardType: HazardType;
    latitude: number;
    longitude: number;
    locationLabel?: string;
    region?: string;
    eventTime: string;
    details: Record<string, unknown>;
  }): Promise<HazardEvent> {
    const normalized: NormalizedHazardEvent = {
      hazardType: input.hazardType,
      externalId: `manual-${randomUUID()}`,
      latitude: input.latitude,
      longitude: input.longitude,
      locationLabel: input.locationLabel ?? null,
      region: input.region ?? null,
      eventTime: new Date(input.eventTime),
      source: 'manual',
      rawPayload: { ...input },
      details: input.details,
    };
    const event = await this.ingestEvent(normalized);
    if (!event) {
      throw new BadRequestException(
        'Manual hazard event was rejected — check details against the schema for this hazardType',
      );
    }
    return event;
  }

  async simulateEarthquake(
    overrides: {
      magnitude?: number;
      depthKm?: number;
      potentialTsunami?: boolean;
      latitude?: number;
      longitude?: number;
      locationLabel?: string;
      region?: string;
    } = {},
  ): Promise<HazardEvent> {
    const epicenter =
      SIMULATED_EARTHQUAKE_EPICENTERS[
        Math.floor(Math.random() * SIMULATED_EARTHQUAKE_EPICENTERS.length)
      ];

    const magnitude = overrides.magnitude ?? randomInRange(6.0, 7.5);
    const depthKm = overrides.depthKm ?? randomInRange(10, 60);
    const latitude =
      overrides.latitude ?? epicenter.latitude + randomInRange(-0.05, 0.05);
    const longitude =
      overrides.longitude ?? epicenter.longitude + randomInRange(-0.05, 0.05);

    const normalized: NormalizedHazardEvent = {
      hazardType: HazardType.EARTHQUAKE,
      externalId: `simulation-${randomUUID()}`,
      latitude,
      longitude,
      locationLabel: overrides.locationLabel ?? epicenter.label,
      region: overrides.region ?? epicenter.region,
      eventTime: new Date(),
      source: 'simulation',
      rawPayload: { simulated: true, epicenter: epicenter.label, ...overrides },
      details: {
        magnitude,
        depthKm,
        potentialTsunami:
          overrides.potentialTsunami ?? (magnitude >= 7 && depthKm < 70),
      },
    };

    const event = await this.ingestEvent(normalized);
    if (!event) {
      throw new BadRequestException(
        'Simulated earthquake was rejected by validation — this indicates a bug in the simulator defaults',
      );
    }
    return event;
  }

  /**
   * Deletes every hazard event created via the simulate/* endpoints
   * (source: 'simulation'). *_details, hazard_affected_regions,
   * hazard_relationships, risk_assessments, resource_optimization_plans,
   * notifications, and cv_detections rows referencing them are removed
   * automatically via ON DELETE CASCADE (see InitialSchema migration).
   */
  async deleteAllSimulated(): Promise<{ deletedCount: number }> {
    const result = await this.hazardEventRepository.delete({
      source: 'simulation',
    });
    return { deletedCount: result.affected ?? 0 };
  }

  /**
   * Validates, dedupes, persists (hazard_event + matching *_details),
   * resolves affected districts, checks for cascading-hazard relationships,
   * and emits HAZARD_EVENT_CREATED. Returns null (not an error) if the
   * event is invalid or already known — both are routine outcomes of
   * polling an external feed.
   */
  async ingestEvent(event: NormalizedHazardEvent): Promise<HazardEvent | null> {
    const ingested = await this.ingestEventWithoutAnnouncing(event);
    if (!ingested) return null;
    this.announce(ingested.announcement);
    return ingested.hazardEvent;
  }

  /**
   * `ingestEvent` minus the HAZARD_EVENT_CREATED emit, for high-volume
   * sources whose adapter decides which of a poll's new events are worth
   * announcing (risk pipeline, notifications, live broadcast) — see
   * `HazardDataSourceAdapter.selectAnnouncements`. The returned
   * `announcement` is what `ingestEvent` would have emitted.
   */
  async ingestEventWithoutAnnouncing(
    event: NormalizedHazardEvent,
  ): Promise<IngestedHazardEvent | null> {
    const detailsError = this.validateDetails(event.hazardType, event.details);
    if (detailsError) {
      this.logger.warn(
        `Rejected ${event.hazardType} event from ${event.source}: ${detailsError}`,
      );
      return null;
    }
    if (
      !Number.isFinite(event.latitude) ||
      event.latitude < -90 ||
      event.latitude > 90 ||
      !Number.isFinite(event.longitude) ||
      event.longitude < -180 ||
      event.longitude > 180
    ) {
      this.logger.warn(
        `Rejected ${event.hazardType} event from ${event.source}: invalid coordinates`,
      );
      return null;
    }
    if (Number.isNaN(event.eventTime.getTime())) {
      this.logger.warn(
        `Rejected ${event.hazardType} event from ${event.source}: invalid eventTime`,
      );
      return null;
    }

    const existing = await this.hazardEventRepository.findOne({
      where: { externalId: event.externalId, source: event.source },
    });
    if (existing) {
      return null;
    }

    const locationLabel =
      event.locationLabel ??
      (await this.resolveFallbackLocationLabel(
        event.latitude,
        event.longitude,
      ));

    const hazardEvent = this.hazardEventRepository.create({
      hazardType: event.hazardType,
      externalId: event.externalId,
      latitude: event.latitude,
      longitude: event.longitude,
      geom: {
        type: 'Point',
        coordinates: [event.longitude, event.latitude],
      } as unknown as object,
      locationLabel,
      region: event.region,
      eventTime: event.eventTime,
      source: event.source,
      rawPayload: event.rawPayload,
    });
    await this.hazardEventRepository.save(hazardEvent);

    await this.persistDetails(hazardEvent.id, event.hazardType, event.details);

    this.logger.log(
      `Ingested ${event.hazardType} hazard event ${hazardEvent.id} from ${event.source}`,
    );

    const severityMagnitude =
      event.hazardType === HazardType.EARTHQUAKE
        ? (event.details as unknown as EarthquakeDetailsShape).magnitude
        : null;

    const affectedDistrictIds =
      await this.spatialIntelligenceService.resolveAffectedRegions(
        hazardEvent,
        severityMagnitude,
      );

    // Cascading-hazard detection is best-effort — a failure here must never
    // block the hazard event itself from being visible.
    try {
      await this.spatialIntelligenceService.detectRelationships(hazardEvent);
    } catch (error) {
      this.logger.warn(
        `Hazard relationship detection failed for ${hazardEvent.id}: ${(error as Error).message}`,
      );
    }

    return {
      hazardEvent,
      announcement: {
        hazardEventId: hazardEvent.id,
        hazardType: hazardEvent.hazardType,
        affectedDistrictIds,
      },
    };
  }

  announce(payload: HazardEventCreatedEvent): void {
    this.eventEmitter.emit(DomainEvents.HAZARD_EVENT_CREATED, payload);
  }

  /**
   * Adapters that only have raw coordinates (e.g. NASA FIRMS hotspots, or a
   * weather station with no `riverBasin` set) normalize `locationLabel` to
   * null. Rather than showing a blank title/location everywhere the event
   * is rendered, fall back to the nearest district name, then to formatted
   * coordinates if no district covers this point (e.g. offshore).
   */
  private async resolveFallbackLocationLabel(
    latitude: number,
    longitude: number,
  ): Promise<string> {
    const nearby = await this.geoService.findNearbyDistricts(
      latitude,
      longitude,
      50_000,
    );
    if (nearby.length > 0) {
      return nearby[0].name;
    }
    return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  }

  private validateDetails(
    hazardType: HazardType,
    details: Record<string, unknown>,
  ): string | null {
    switch (hazardType) {
      case HazardType.EARTHQUAKE:
        return validateEarthquakeDetails(
          details as Partial<EarthquakeDetailsShape>,
        );
      case HazardType.LANDSLIDE:
        return validateLandslideDetails(
          details as Partial<LandslideDetailsShape>,
        );
      case HazardType.FLOOD:
        return validateFloodDetails(details as Partial<FloodDetailsShape>);
      case HazardType.WILDFIRE:
        return validateWildfireDetails(
          details as Partial<WildfireDetailsShape>,
        );
      default:
        return `Unsupported hazardType: ${hazardType}`;
    }
  }

  private async persistDetails(
    hazardEventId: string,
    hazardType: HazardType,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (hazardType === HazardType.EARTHQUAKE) {
      const shape = details as unknown as EarthquakeDetailsShape;
      await this.earthquakeDetailsRepository.save(
        this.earthquakeDetailsRepository.create({
          hazardEventId,
          magnitude: shape.magnitude,
          depthKm: shape.depthKm,
          potentialTsunami: shape.potentialTsunami ?? false,
        }),
      );
      return;
    }
    if (hazardType === HazardType.LANDSLIDE) {
      const shape = details as unknown as LandslideDetailsShape;
      await this.landslideDetailsRepository.save(
        this.landslideDetailsRepository.create({
          hazardEventId,
          slopeDegrees: shape.slopeDegrees ?? null,
          soilSaturation: shape.soilSaturation ?? null,
          triggeringRainfallMm: shape.triggeringRainfallMm ?? null,
        }),
      );
      return;
    }
    if (hazardType === HazardType.FLOOD) {
      const shape = details as unknown as FloodDetailsShape;
      await this.floodDetailsRepository.save(
        this.floodDetailsRepository.create({
          hazardEventId,
          rainfallMm: shape.rainfallMm ?? null,
          waterLevelM: shape.waterLevelM,
          riverBasin: shape.riverBasin ?? null,
          floodHazardIndex: shape.floodHazardIndex ?? null,
        }),
      );
      return;
    }
    if (hazardType === HazardType.WILDFIRE) {
      const shape = details as unknown as WildfireDetailsShape;
      await this.wildfireDetailsRepository.save(
        this.wildfireDetailsRepository.create({
          hazardEventId,
          frpConfidence: shape.frpConfidence,
          hotspotCount: shape.hotspotCount,
          brightnessKelvin: shape.brightnessKelvin ?? null,
        }),
      );
    }
  }

  private async attachDetails(events: HazardEvent[]): Promise<
    Array<
      HazardEvent & {
        details: Record<string, unknown> | null;
        affectedRegionCount: number;
      }
    >
  > {
    const idsFor = (hazardType: HazardType) =>
      events.filter((e) => e.hazardType === hazardType).map((e) => e.id);

    const earthquakeIds = idsFor(HazardType.EARTHQUAKE);
    const landslideIds = idsFor(HazardType.LANDSLIDE);
    const floodIds = idsFor(HazardType.FLOOD);
    const wildfireIds = idsFor(HazardType.WILDFIRE);

    const affectedRegionCounts =
      await this.spatialIntelligenceService.countAffectedRegionsForEvents(
        events.map((e) => e.id),
      );

    const [earthquakeDetails, landslideDetails, floodDetails, wildfireDetails] =
      await Promise.all([
        earthquakeIds.length
          ? this.earthquakeDetailsRepository
              .createQueryBuilder('d')
              .where('d.hazardEventId IN (:...ids)', { ids: earthquakeIds })
              .getMany()
          : Promise.resolve([] as EarthquakeDetails[]),
        landslideIds.length
          ? this.landslideDetailsRepository
              .createQueryBuilder('d')
              .where('d.hazardEventId IN (:...ids)', { ids: landslideIds })
              .getMany()
          : Promise.resolve([] as LandslideDetails[]),
        floodIds.length
          ? this.floodDetailsRepository
              .createQueryBuilder('d')
              .where('d.hazardEventId IN (:...ids)', { ids: floodIds })
              .getMany()
          : Promise.resolve([] as FloodDetails[]),
        wildfireIds.length
          ? this.wildfireDetailsRepository
              .createQueryBuilder('d')
              .where('d.hazardEventId IN (:...ids)', { ids: wildfireIds })
              .getMany()
          : Promise.resolve([] as WildfireDetails[]),
      ]);

    const earthquakeMap = new Map(
      earthquakeDetails.map((d) => [d.hazardEventId, d]),
    );
    const landslideMap = new Map(
      landslideDetails.map((d) => [d.hazardEventId, d]),
    );
    const floodMap = new Map(floodDetails.map((d) => [d.hazardEventId, d]));
    const wildfireMap = new Map(
      wildfireDetails.map((d) => [d.hazardEventId, d]),
    );

    return events.map((event) => {
      let details: Record<string, unknown> | null = null;
      if (event.hazardType === HazardType.EARTHQUAKE) {
        const d = earthquakeMap.get(event.id);
        details = d
          ? {
              magnitude: d.magnitude,
              depthKm: d.depthKm,
              potentialTsunami: d.potentialTsunami,
            }
          : null;
      } else if (event.hazardType === HazardType.LANDSLIDE) {
        const d = landslideMap.get(event.id);
        details = d
          ? {
              slopeDegrees: d.slopeDegrees,
              soilSaturation: d.soilSaturation,
              triggeringRainfallMm: d.triggeringRainfallMm,
            }
          : null;
      } else if (event.hazardType === HazardType.FLOOD) {
        const d = floodMap.get(event.id);
        details = d
          ? {
              rainfallMm: d.rainfallMm,
              waterLevelM: d.waterLevelM,
              riverBasin: d.riverBasin,
              floodHazardIndex: d.floodHazardIndex,
            }
          : null;
      } else if (event.hazardType === HazardType.WILDFIRE) {
        const d = wildfireMap.get(event.id);
        details = d
          ? {
              frpConfidence: d.frpConfidence,
              hotspotCount: d.hotspotCount,
              brightnessKelvin: d.brightnessKelvin,
            }
          : null;
      }
      return Object.assign(event, {
        details,
        affectedRegionCount: affectedRegionCounts.get(event.id) ?? 0,
      });
    });
  }
}
