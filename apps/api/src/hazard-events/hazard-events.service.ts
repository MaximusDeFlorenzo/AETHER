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
import { DomainEvents } from '../common/events/domain-events';
import type { HazardEventCreatedEvent } from '../common/events/domain-events';
import type { NormalizedHazardEvent } from './hazard-event-normalized.interface';
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

  async findOne(id: string): Promise<HazardEvent & { details: Record<string, unknown> | null }> {
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

  /**
   * Validates, dedupes, persists (hazard_event + matching *_details),
   * resolves affected districts, checks for cascading-hazard relationships,
   * and emits HAZARD_EVENT_CREATED. Returns null (not an error) if the
   * event is invalid or already known — both are routine outcomes of
   * polling an external feed.
   */
  async ingestEvent(event: NormalizedHazardEvent): Promise<HazardEvent | null> {
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

    const hazardEvent = this.hazardEventRepository.create({
      hazardType: event.hazardType,
      externalId: event.externalId,
      latitude: event.latitude,
      longitude: event.longitude,
      geom: {
        type: 'Point',
        coordinates: [event.longitude, event.latitude],
      } as unknown as object,
      locationLabel: event.locationLabel,
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

    const payload: HazardEventCreatedEvent = {
      hazardEventId: hazardEvent.id,
      hazardType: hazardEvent.hazardType,
      affectedDistrictIds,
    };
    this.eventEmitter.emit(DomainEvents.HAZARD_EVENT_CREATED, payload);

    return hazardEvent;
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
          rainfallMm: shape.rainfallMm,
          waterLevelM: shape.waterLevelM,
          riverBasin: shape.riverBasin ?? null,
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

  private async attachDetails(
    events: HazardEvent[],
  ): Promise<Array<HazardEvent & { details: Record<string, unknown> | null }>> {
    const idsFor = (hazardType: HazardType) =>
      events.filter((e) => e.hazardType === hazardType).map((e) => e.id);

    const earthquakeIds = idsFor(HazardType.EARTHQUAKE);
    const landslideIds = idsFor(HazardType.LANDSLIDE);
    const floodIds = idsFor(HazardType.FLOOD);
    const wildfireIds = idsFor(HazardType.WILDFIRE);

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
      return Object.assign(event, { details });
    });
  }
}
