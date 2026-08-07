import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import {
  District,
  HazardAffectedRegion,
  HazardEvent,
  HazardRelationship,
} from '../database/entities';
import { GeoService } from '../geo/geo.service';
import { HazardType } from '../common/enums/domain.enum';
import { HAZARD_RELATIONSHIP_RULES } from './hazard-relationship-rules';
import { DomainEvents } from '../common/events/domain-events';
import type { HazardRelationshipDetectedEvent } from '../common/events/domain-events';
import { OverlayLayer } from './dto/query-spatial-overlay.dto';

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: Record<string, unknown> | null;
    properties: Record<string, unknown>;
  }>;
}

const MIN_RADIUS_KM = 20;
const MAX_RADIUS_KM = 300;
const EARTHQUAKE_RADIUS_SLOPE_KM_PER_MAGNITUDE = 50;
const EARTHQUAKE_RADIUS_BASE_MAGNITUDE = 4.0;
// Landslides are far more localized than earthquakes — a small fixed radius
// default rather than a magnitude-derived one (docs/DATABASE_SCHEMA.md §15).
const LANDSLIDE_FIXED_RADIUS_KM = 15;
// Floods are localized to a floodplain/river basin rather than radiating
// from a point, but lacking watershed polygon data (docs/ARCHITECTURE.md §5)
// this uses the same point-radius model as every other hazard, sized for a
// typical floodplain — matches apps/ai-engine's flood.py proximity radius.
const FLOOD_FIXED_RADIUS_KM = 10;
// Wildfires spread with wind well beyond the detected hotspot pixel — the
// widest fixed radius here, matching apps/ai-engine's wildfire.py.
const WILDFIRE_FIXED_RADIUS_KM = 25;

@Injectable()
export class SpatialIntelligenceService {
  private readonly logger = new Logger(SpatialIntelligenceService.name);

  constructor(
    @InjectRepository(HazardAffectedRegion)
    private readonly affectedRegionRepository: Repository<HazardAffectedRegion>,
    @InjectRepository(HazardRelationship)
    private readonly hazardRelationshipRepository: Repository<HazardRelationship>,
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    private readonly geoService: GeoService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Generalizes ORION's earthquake-only radius formula
   * (docs/DATABASE_SCHEMA.md §15): resolves districts within a
   * severity-derived (earthquake) or fixed (landslide) radius, persists
   * `hazard_affected_regions`, and returns the affected district ids.
   */
  async resolveAffectedRegions(
    hazardEvent: HazardEvent,
    severityMagnitude?: number | null,
  ): Promise<string[]> {
    const radiusKm = this.resolveRadiusKm(
      hazardEvent.hazardType,
      severityMagnitude,
    );

    const nearby = await this.geoService.findNearbyDistricts(
      hazardEvent.latitude,
      hazardEvent.longitude,
      radiusKm * 1000,
    );

    if (nearby.length === 0) {
      this.logger.warn(
        `No districts found within ${radiusKm}km of hazard event ${hazardEvent.id} — seed data may not cover this region`,
      );
      return [];
    }

    const rows = nearby.map((district) =>
      this.affectedRegionRepository.create({
        hazardEvent,
        district: { id: district.id },
        distanceKm: district.distanceKm,
      }),
    );
    await this.affectedRegionRepository.save(rows);

    return nearby.map((d) => d.id);
  }

  private resolveRadiusKm(
    hazardType: HazardType,
    severityMagnitude?: number | null,
  ): number {
    if (hazardType === HazardType.EARTHQUAKE && severityMagnitude != null) {
      return Math.min(
        MAX_RADIUS_KM,
        Math.max(
          MIN_RADIUS_KM,
          EARTHQUAKE_RADIUS_SLOPE_KM_PER_MAGNITUDE *
            (severityMagnitude - EARTHQUAKE_RADIUS_BASE_MAGNITUDE),
        ),
      );
    }
    if (hazardType === HazardType.LANDSLIDE) {
      return LANDSLIDE_FIXED_RADIUS_KM;
    }
    if (hazardType === HazardType.FLOOD) {
      return FLOOD_FIXED_RADIUS_KM;
    }
    if (hazardType === HazardType.WILDFIRE) {
      return WILDFIRE_FIXED_RADIUS_KM;
    }
    return MIN_RADIUS_KM;
  }

  /**
   * Checks `HAZARD_RELATIONSHIP_RULES` for a recent nearby event of a
   * different hazard_type and, on a match, writes a `hazard_relationships`
   * row — the core "model relationships between hazards" requirement
   * (docs/DATABASE_SCHEMA.md §16). Simple fixed time-window + distance
   * threshold, not ML, by design.
   */
  async detectRelationships(hazardEvent: HazardEvent): Promise<void> {
    const applicableRules = HAZARD_RELATIONSHIP_RULES.filter(
      (rule) => rule.to === hazardEvent.hazardType,
    );
    if (applicableRules.length === 0) {
      return;
    }

    for (const rule of applicableRules) {
      const windowStart = new Date(
        hazardEvent.eventTime.getTime() - rule.withinHours * 60 * 60 * 1000,
      );

      const candidates = await this.hazardEventRepository
        .createQueryBuilder('e')
        .where('e.hazardType = :hazardType', { hazardType: rule.from })
        .andWhere('e.eventTime BETWEEN :windowStart AND :windowEnd', {
          windowStart,
          windowEnd: hazardEvent.eventTime,
        })
        .andWhere(
          `ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radiusMeters)`,
          {
            lon: hazardEvent.longitude,
            lat: hazardEvent.latitude,
            radiusMeters: rule.withinKm * 1000,
          },
        )
        .getMany();

      for (const sourceEvent of candidates) {
        const distanceKm = await this.distanceKm(sourceEvent, hazardEvent);
        const hoursApart =
          (hazardEvent.eventTime.getTime() - sourceEvent.eventTime.getTime()) /
          (60 * 60 * 1000);

        // Simple linear decay by how close to the window edges the match
        // is — a same-minute, same-spot match scores near baseConfidence;
        // one at the edge of the window/radius scores lower.
        const timeFactor = 1 - hoursApart / rule.withinHours;
        const distanceFactor = 1 - distanceKm / rule.withinKm;
        const confidenceScore = Math.max(
          0.1,
          Math.min(
            0.99,
            rule.baseConfidence * 0.5 +
              rule.baseConfidence * 0.25 * timeFactor +
              rule.baseConfidence * 0.25 * distanceFactor,
          ),
        );

        const existing = await this.hazardRelationshipRepository.findOne({
          where: {
            sourceEvent: { id: sourceEvent.id },
            relatedEvent: { id: hazardEvent.id },
            relationshipType: rule.type,
          },
        });
        if (existing) continue;

        const saved = await this.hazardRelationshipRepository.save(
          this.hazardRelationshipRepository.create({
            sourceEvent,
            relatedEvent: hazardEvent,
            relationshipType: rule.type,
            confidenceScore: Math.round(confidenceScore * 1000) / 1000,
          }),
        );

        this.logger.log(
          `Detected ${rule.type} relationship: ${rule.from} ${sourceEvent.id} -> ${rule.to} ${hazardEvent.id} (confidence ${saved.confidenceScore})`,
        );

        const payload: HazardRelationshipDetectedEvent = {
          hazardRelationshipId: saved.id,
          sourceEventId: sourceEvent.id,
          relatedEventId: hazardEvent.id,
          relationshipType: saved.relationshipType,
          confidenceScore: saved.confidenceScore,
        };
        this.eventEmitter.emit(
          DomainEvents.HAZARD_RELATIONSHIP_DETECTED,
          payload,
        );
      }
    }
  }

  findRelationshipsForEvent(
    hazardEventId: string,
  ): Promise<HazardRelationship[]> {
    return this.hazardRelationshipRepository.find({
      where: [
        { sourceEvent: { id: hazardEventId } },
        { relatedEvent: { id: hazardEventId } },
      ],
      relations: { sourceEvent: true, relatedEvent: true },
      order: { createdAt: 'DESC' },
    });
  }

  private async distanceKm(a: HazardEvent, b: HazardEvent): Promise<number> {
    const rows: Array<{ distanceKm: string }> =
      await this.hazardEventRepository.query(
        `SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
         ) / 1000 AS "distanceKm"`,
        [a.longitude, a.latitude, b.longitude, b.latitude],
      );
    return Number.parseFloat(rows[0]?.distanceKm ?? '0');
  }

  /**
   * GET /spatial/overlay (docs/API_SPEC.md §6) — the polygon-overlay endpoint
   * ORION never had (it only ever served point data). Returns a GeoJSON
   * FeatureCollection of district polygons with layer-specific properties:
   * `risk`/`exposure` join the latest matching risk_assessments row per
   * district, `vulnerability` joins the latest vulnerability_indicators rows.
   */
  async getOverlay(
    layer: OverlayLayer,
    hazardType?: HazardType,
    bbox?: string,
  ): Promise<GeoJsonFeatureCollection> {
    const envelope = this.parseBbox(bbox);

    const districtRows: Array<{
      id: string;
      name: string;
      geojson: string | null;
    }> = envelope
      ? await this.districtRepository.query(
          `SELECT id, name, ST_AsGeoJSON(geom) AS geojson
           FROM districts
           WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))`,
          envelope,
        )
      : await this.districtRepository.query(
          `SELECT id, name, ST_AsGeoJSON(geom) AS geojson FROM districts`,
        );

    const propertiesByDistrict = await this.loadOverlayProperties(
      layer,
      hazardType,
    );

    return {
      type: 'FeatureCollection',
      features: districtRows.map((row) => ({
        type: 'Feature',
        geometry: row.geojson
          ? (JSON.parse(row.geojson) as Record<string, unknown>)
          : null,
        properties: {
          districtId: row.id,
          districtName: row.name,
          ...(propertiesByDistrict.get(row.id) ?? {}),
        },
      })),
    };
  }

  private parseBbox(bbox?: string): [number, number, number, number] | null {
    if (!bbox) return null;
    const parts = bbox.split(',').map((v) => Number.parseFloat(v.trim()));
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
      return null;
    }
    return parts as [number, number, number, number];
  }

  private async loadOverlayProperties(
    layer: OverlayLayer,
    hazardType?: HazardType,
  ): Promise<Map<string, Record<string, unknown>>> {
    const properties = new Map<string, Record<string, unknown>>();

    if (layer === OverlayLayer.RISK || layer === OverlayLayer.EXPOSURE) {
      const rows: Array<{
        districtId: string;
        riskScore: string;
        exposureLevel: string | null;
        hazardType: string;
        assessedAt: Date;
      }> = await this.hazardEventRepository.query(
        `SELECT DISTINCT ON (district_id) district_id AS "districtId",
                risk_score AS "riskScore", exposure_level AS "exposureLevel",
                hazard_type AS "hazardType", assessed_at AS "assessedAt"
         FROM risk_assessments
         WHERE ($1::text IS NULL OR hazard_type::text = $1)
         ORDER BY district_id, assessed_at DESC`,
        [hazardType ?? null],
      );
      for (const row of rows) {
        properties.set(row.districtId, {
          riskScore: Number.parseFloat(row.riskScore),
          exposureLevel: row.exposureLevel,
          hazardType: row.hazardType,
          assessedAt: row.assessedAt,
        });
      }
      return properties;
    }

    // vulnerability layer
    const rows: Array<{
      districtId: string;
      indicatorType: string;
      value: string;
      unit: string | null;
      year: number;
    }> = await this.hazardEventRepository.query(
      `SELECT DISTINCT ON (district_id, indicator_type) district_id AS "districtId",
              indicator_type AS "indicatorType", value, unit, year
       FROM vulnerability_indicators
       ORDER BY district_id, indicator_type, year DESC`,
    );
    for (const row of rows) {
      const existing = properties.get(row.districtId) ?? { indicators: [] };
      (existing.indicators as unknown[]).push({
        type: row.indicatorType,
        value: Number.parseFloat(row.value),
        unit: row.unit,
        year: row.year,
      });
      properties.set(row.districtId, existing);
    }
    return properties;
  }
}
