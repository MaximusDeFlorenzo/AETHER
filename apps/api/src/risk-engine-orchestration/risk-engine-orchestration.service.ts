import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import {
  DecisionRecommendation,
  District,
  EarthquakeDetails,
  FloodDetails,
  HazardAffectedRegion,
  HazardEvent,
  LandslideDetails,
  RiskAssessment,
  WildfireDetails,
} from '../database/entities';
import {
  ExposureLevel,
  HazardType,
  PriorityLevel,
  RiskAssessmentStatus,
} from '../common/enums/domain.enum';
import { RiskEngineClient } from './risk-engine.client';
import { GeoService } from '../geo/geo.service';
import { HistoricalService } from '../historical/historical.service';
import { DomainEvents } from '../common/events/domain-events';
import type {
  DecisionRecommendationCreatedEvent,
  HazardEventCreatedEvent,
  RiskAssessmentCompletedEvent,
  RiskAssessmentFailedEvent,
} from '../common/events/domain-events';
import type {
  RiskEngineDistrictInput,
  RiskEngineHazardEventInput,
} from './risk-engine.types';

const BASELINE_HAZARD_TYPES = [
  HazardType.EARTHQUAKE,
  HazardType.LANDSLIDE,
  HazardType.FLOOD,
  HazardType.WILDFIRE,
];

/**
 * Conservative "typical/background conditions" fallback used by baseline
 * scans when a district has no prior `hazard_events` of a given type to
 * average (e.g. a brand-new deployment, or a district that's simply never
 * had one) — every value sits deliberately at the low end of its valid
 * range so a district with zero history reads as low, not alarming, risk
 * rather than being skipped outright. Real per-district history (see
 * `buildBaselineHazardEventInput`) always takes precedence over these.
 */
const BASELINE_DEFAULTS = {
  [HazardType.EARTHQUAKE]: { magnitude: 4.0, depthKm: 10 },
  [HazardType.LANDSLIDE]: {
    slopeDegrees: 10,
    soilSaturation: 0.2,
    triggeringRainfallMm: 0,
  },
  [HazardType.FLOOD]: { rainfallMm: 5, waterLevelM: 0.5 },
  [HazardType.WILDFIRE]: {
    frpConfidence: 0.05,
    hotspotCount: 0,
    brightnessKelvin: null as number | null,
  },
} as const;

/** Postgres numeric aggregates (`AVG(...)`) come back as strings (or `null`
 * when there are zero matching rows) via the pg driver — same reason
 * `numericTransformer` exists on entities, but raw `AVG()` results bypass it. */
function parseAvg(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class RiskEngineOrchestrationService {
  private readonly logger = new Logger(RiskEngineOrchestrationService.name);

  constructor(
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectRepository(HazardAffectedRegion)
    private readonly affectedRegionRepository: Repository<HazardAffectedRegion>,
    @InjectRepository(RiskAssessment)
    private readonly riskAssessmentRepository: Repository<RiskAssessment>,
    @InjectRepository(DecisionRecommendation)
    private readonly decisionRecommendationRepository: Repository<DecisionRecommendation>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(EarthquakeDetails)
    private readonly earthquakeDetailsRepository: Repository<EarthquakeDetails>,
    @InjectRepository(LandslideDetails)
    private readonly landslideDetailsRepository: Repository<LandslideDetails>,
    @InjectRepository(FloodDetails)
    private readonly floodDetailsRepository: Repository<FloodDetails>,
    @InjectRepository(WildfireDetails)
    private readonly wildfireDetailsRepository: Repository<WildfireDetails>,
    private readonly riskEngineClient: RiskEngineClient,
    private readonly geoService: GeoService,
    private readonly historicalService: HistoricalService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(DomainEvents.HAZARD_EVENT_CREATED, { async: true })
  async handleHazardEventCreated(
    event: HazardEventCreatedEvent,
  ): Promise<void> {
    if (event.affectedDistrictIds.length === 0) {
      return;
    }
    await Promise.allSettled(
      event.affectedDistrictIds.map((districtId) =>
        this.processDistrict(event.hazardEventId, districtId),
      ),
    );
  }

  /** Manual re-trigger (e.g. an admin endpoint) — reprocesses every district
   * already resolved as affected for this hazard event. */
  async runPipelineForHazardEvent(
    hazardEventId: string,
  ): Promise<{ districtsQueued: number }> {
    const affected = await this.affectedRegionRepository.find({
      where: { hazardEvent: { id: hazardEventId } },
      relations: { district: true },
    });

    await Promise.allSettled(
      affected.map((row) =>
        this.processDistrict(hazardEventId, row.district.id),
      ),
    );

    return { districtsQueued: affected.length };
  }

  /**
   * Standing/baseline risk scoring (docs/ARCHITECTURE.md §2.2) — the
   * pipeline ORION never had. Periodically scores every district for every
   * hazard type in `BASELINE_HAZARD_TYPES` with `hazardEvent = null`,
   * independent of any active event. `buildBaselineHazardEventInput`
   * synthesizes a "typical conditions" input per district/hazard type from
   * that district's own hazard history, falling back to conservative
   * defaults when there isn't any yet — see its docstring.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async runBaselineScan(): Promise<void> {
    const districts = await this.districtRepository.find({
      relations: { province: true },
    });
    this.logger.log(
      `Starting baseline risk scan for ${districts.length} district(s)`,
    );

    for (const district of districts) {
      for (const hazardType of BASELINE_HAZARD_TYPES) {
        await this.processDistrict(null, district.id, hazardType);
      }
    }
  }

  /**
   * Builds apps/ai-engine's required `hazardEvent` input from the concrete
   * `*_details` row — apps/ai-engine's Pydantic schema requires
   * `latitude`/`longitude` plus a populated, hazard-type-matching details
   * block (docs/API_SPEC.md "Internal API"), not just a bare `hazardType`.
   * Returns `null` (with a warning) if the matching details row is
   * missing/incomplete, which callers must treat as "skip this
   * district/hazard, don't call the AI engine."
   */
  private async buildHazardEventInput(
    hazardEvent: HazardEvent,
  ): Promise<RiskEngineHazardEventInput | null> {
    const base = {
      hazardType: hazardEvent.hazardType,
      latitude: hazardEvent.latitude,
      longitude: hazardEvent.longitude,
      eventTime: hazardEvent.eventTime.toISOString(),
    };

    if (hazardEvent.hazardType === HazardType.EARTHQUAKE) {
      const details = await this.earthquakeDetailsRepository.findOne({
        where: { hazardEventId: hazardEvent.id },
      });
      if (!details) return null;
      return {
        ...base,
        earthquake: { magnitude: details.magnitude, depthKm: details.depthKm },
      };
    }
    if (hazardEvent.hazardType === HazardType.LANDSLIDE) {
      const details = await this.landslideDetailsRepository.findOne({
        where: { hazardEventId: hazardEvent.id },
      });
      if (
        !details ||
        details.slopeDegrees === null ||
        details.soilSaturation === null ||
        details.triggeringRainfallMm === null
      ) {
        return null;
      }
      return {
        ...base,
        landslide: {
          slopeDegrees: details.slopeDegrees,
          soilSaturation: details.soilSaturation,
          triggeringRainfallMm: details.triggeringRainfallMm,
        },
      };
    }
    if (hazardEvent.hazardType === HazardType.FLOOD) {
      const details = await this.floodDetailsRepository.findOne({
        where: { hazardEventId: hazardEvent.id },
      });
      if (
        !details ||
        details.rainfallMm === null ||
        details.waterLevelM === null
      ) {
        return null;
      }
      return {
        ...base,
        flood: {
          rainfallMm: details.rainfallMm,
          waterLevelM: details.waterLevelM,
          riverBasin: details.riverBasin,
        },
      };
    }
    if (hazardEvent.hazardType === HazardType.WILDFIRE) {
      const details = await this.wildfireDetailsRepository.findOne({
        where: { hazardEventId: hazardEvent.id },
      });
      if (
        !details ||
        details.frpConfidence === null ||
        details.hotspotCount === null
      ) {
        return null;
      }
      return {
        ...base,
        wildfire: {
          frpConfidence: details.frpConfidence,
          hotspotCount: details.hotspotCount,
          brightnessKelvin: details.brightnessKelvin,
        },
      };
    }
    return null;
  }

  /**
   * Synthesizes a "typical conditions" `hazardEvent` input for a baseline
   * scan (no concrete triggering event) — what `runBaselineScan` needs to
   * actually produce a `risk_assessments` row instead of skipping every
   * district/hazard-type combination forever.
   *
   * Primary source: average the real `*_details` fields across this
   * district's own past `hazard_events` of the given type (resolved via
   * `hazard_affected_regions`, the same join `SpatialIntelligenceService`
   * uses) — genuine local signal, no new tables. Falls back to
   * `BASELINE_DEFAULTS` when the district has no matching history yet.
   * Never returns `null` for a type in `BASELINE_HAZARD_TYPES` — unlike
   * `buildHazardEventInput`, there's no "incomplete details row" case here
   * since every field is either an average or a documented default.
   */
  private async buildBaselineHazardEventInput(
    districtId: string,
    hazardType: HazardType,
  ): Promise<RiskEngineHazardEventInput> {
    const centroid = await this.geoService.getDistrictCentroid(districtId);
    const base = {
      hazardType,
      latitude: centroid.latitude,
      longitude: centroid.longitude,
      eventTime: new Date().toISOString(),
    };

    if (hazardType === HazardType.EARTHQUAKE) {
      const avg = await this.earthquakeDetailsRepository
        .createQueryBuilder('d')
        .innerJoin('d.hazardEvent', 'e')
        .innerJoin(
          'hazard_affected_regions',
          'har',
          'har.hazard_event_id = e.id',
        )
        .where('har.district_id = :districtId', { districtId })
        .select('AVG(d.magnitude)', 'magnitude')
        .addSelect('AVG(d.depthKm)', 'depthKm')
        .getRawOne<{ magnitude: string | null; depthKm: string | null }>();
      const defaults = BASELINE_DEFAULTS[HazardType.EARTHQUAKE];
      return {
        ...base,
        earthquake: {
          magnitude: parseAvg(avg?.magnitude) ?? defaults.magnitude,
          depthKm: parseAvg(avg?.depthKm) ?? defaults.depthKm,
        },
      };
    }

    if (hazardType === HazardType.LANDSLIDE) {
      const avg = await this.landslideDetailsRepository
        .createQueryBuilder('d')
        .innerJoin('d.hazardEvent', 'e')
        .innerJoin(
          'hazard_affected_regions',
          'har',
          'har.hazard_event_id = e.id',
        )
        .where('har.district_id = :districtId', { districtId })
        .select('AVG(d.slopeDegrees)', 'slopeDegrees')
        .addSelect('AVG(d.soilSaturation)', 'soilSaturation')
        .addSelect('AVG(d.triggeringRainfallMm)', 'triggeringRainfallMm')
        .getRawOne<{
          slopeDegrees: string | null;
          soilSaturation: string | null;
          triggeringRainfallMm: string | null;
        }>();
      const defaults = BASELINE_DEFAULTS[HazardType.LANDSLIDE];
      return {
        ...base,
        landslide: {
          slopeDegrees: parseAvg(avg?.slopeDegrees) ?? defaults.slopeDegrees,
          soilSaturation:
            parseAvg(avg?.soilSaturation) ?? defaults.soilSaturation,
          triggeringRainfallMm:
            parseAvg(avg?.triggeringRainfallMm) ??
            defaults.triggeringRainfallMm,
        },
      };
    }

    if (hazardType === HazardType.FLOOD) {
      const avg = await this.floodDetailsRepository
        .createQueryBuilder('d')
        .innerJoin('d.hazardEvent', 'e')
        .innerJoin(
          'hazard_affected_regions',
          'har',
          'har.hazard_event_id = e.id',
        )
        .where('har.district_id = :districtId', { districtId })
        .select('AVG(d.rainfallMm)', 'rainfallMm')
        .addSelect('AVG(d.waterLevelM)', 'waterLevelM')
        .getRawOne<{ rainfallMm: string | null; waterLevelM: string | null }>();
      const defaults = BASELINE_DEFAULTS[HazardType.FLOOD];
      return {
        ...base,
        flood: {
          rainfallMm: parseAvg(avg?.rainfallMm) ?? defaults.rainfallMm,
          waterLevelM: parseAvg(avg?.waterLevelM) ?? defaults.waterLevelM,
        },
      };
    }

    // hazardType === HazardType.WILDFIRE (the only remaining member of
    // BASELINE_HAZARD_TYPES).
    const avg = await this.wildfireDetailsRepository
      .createQueryBuilder('d')
      .innerJoin('d.hazardEvent', 'e')
      .innerJoin('hazard_affected_regions', 'har', 'har.hazard_event_id = e.id')
      .where('har.district_id = :districtId', { districtId })
      .select('AVG(d.frpConfidence)', 'frpConfidence')
      .addSelect('AVG(d.hotspotCount)', 'hotspotCount')
      .addSelect('AVG(d.brightnessKelvin)', 'brightnessKelvin')
      .getRawOne<{
        frpConfidence: string | null;
        hotspotCount: string | null;
        brightnessKelvin: string | null;
      }>();
    const defaults = BASELINE_DEFAULTS[HazardType.WILDFIRE];
    return {
      ...base,
      wildfire: {
        frpConfidence: parseAvg(avg?.frpConfidence) ?? defaults.frpConfidence,
        hotspotCount: Math.round(
          parseAvg(avg?.hotspotCount) ?? defaults.hotspotCount,
        ),
        brightnessKelvin:
          parseAvg(avg?.brightnessKelvin) ?? defaults.brightnessKelvin,
      },
    };
  }

  private async processDistrict(
    hazardEventId: string | null,
    districtId: string,
    baselineHazardType?: HazardType,
  ): Promise<void> {
    let riskAssessmentId: string | undefined;
    const hazardType = baselineHazardType ?? HazardType.EARTHQUAKE;

    try {
      const hazardEvent = hazardEventId
        ? await this.hazardEventRepository.findOneOrFail({
            where: { id: hazardEventId },
          })
        : null;
      const resolvedHazardType = hazardEvent?.hazardType ?? hazardType;

      const hazardEventInput = hazardEvent
        ? await this.buildHazardEventInput(hazardEvent)
        : await this.buildBaselineHazardEventInput(districtId, hazardType);
      if (!hazardEventInput) {
        // Only reachable for the event-triggered path — the matching
        // *_details row is missing or incomplete (buildHazardEventInput's
        // docstring). Baseline scans always produce a valid input (see
        // buildBaselineHazardEventInput's docstring).
        this.logger.warn(
          `Skipping risk pipeline for hazardEvent=${hazardEventId}: ` +
            'matching *_details row is missing or incomplete',
        );
        return;
      }

      const district = await this.geoService.findDistrictOrThrow(districtId);
      const population = await this.geoService.getLatestPopulation(districtId);

      let distanceKm: number | null = null;
      if (hazardEventId) {
        const affectedRow = await this.affectedRegionRepository.findOne({
          where: {
            hazardEvent: { id: hazardEventId },
            district: { id: districtId },
          },
        });
        distanceKm = affectedRow?.distanceKm ?? null;
      }

      const districtInput: RiskEngineDistrictInput = {
        id: district.id,
        name: district.name,
        totalPopulation: population.totalPopulation,
        populationDensity: population.populationDensity,
        distanceFromEventKm: distanceKm ?? 0,
      };

      // Historical relevance filtering falls back to recency when magnitude
      // is unknown (e.g. non-earthquake hazards, or an earthquake event
      // whose magnitude isn't threaded through here) — see
      // HistoricalService.findRelevantForHazardEvent.
      const historicalRecords =
        await this.historicalService.findRelevantForHazardEvent(
          resolvedHazardType,
          district.province.id,
          null,
        );
      const historicalInput = historicalRecords.map((record) => ({
        eventDate: record.eventDate,
        magnitude: record.magnitude,
        casualtiesDead: record.casualtiesDead,
        damagedBuildingsCount: record.damagedBuildingsCount,
      }));

      const inputSnapshot = {
        hazardType: resolvedHazardType,
        hazardEvent: hazardEventInput,
        district: districtInput,
        historicalDisasters: historicalInput,
      };

      const riskAssessment = await this.riskAssessmentRepository.save(
        this.riskAssessmentRepository.create({
          hazardEvent: hazardEvent ?? null,
          hazardType: resolvedHazardType,
          district: { id: districtId } as District,
          riskScore: 0,
          status: RiskAssessmentStatus.PENDING,
          inputSnapshot,
        }),
      );
      riskAssessmentId = riskAssessment.id;

      const predictResult = await this.riskEngineClient.predictRisk({
        hazardEvent: hazardEventInput,
        district: districtInput,
        historicalDisasters: historicalInput,
      });

      const priorityResult = await this.riskEngineClient.calculatePriority({
        hazardType: resolvedHazardType,
        prediction: predictResult,
        district: districtInput,
      });

      const recommendationResult =
        await this.riskEngineClient.generateRecommendation({
          hazardEvent: hazardEventInput,
          district: districtInput,
          prediction: predictResult,
          priority: priorityResult,
          historicalDisasters: historicalInput,
        });

      riskAssessment.riskScore = predictResult.riskScore;
      riskAssessment.exposureLevel =
        predictResult.exposureLevel as ExposureLevel;
      riskAssessment.estimatedAffectedPopulation =
        predictResult.estimatedAffectedPopulation;
      riskAssessment.confidenceScore = predictResult.confidenceScore;
      riskAssessment.modelVersion = predictResult.modelVersion;
      riskAssessment.status = RiskAssessmentStatus.COMPLETED;
      await this.riskAssessmentRepository.save(riskAssessment);

      const decisionRecommendation =
        await this.decisionRecommendationRepository.save(
          this.decisionRecommendationRepository.create({
            riskAssessment,
            priorityLevel: priorityResult.priorityLevel as PriorityLevel,
            priorityScore: priorityResult.priorityScore,
            confidenceScore: recommendationResult.confidenceScore,
            summaryText: recommendationResult.summaryText,
            reasons: recommendationResult.reasons,
            actionRecommendation: recommendationResult.actionRecommendation,
          }),
        );

      const completedPayload: RiskAssessmentCompletedEvent = {
        riskAssessmentId: riskAssessment.id,
        hazardEventId: hazardEventId,
        hazardType: resolvedHazardType,
        districtId,
        districtName: district.name,
        riskScore: predictResult.riskScore,
        exposureLevel: predictResult.exposureLevel,
      };
      this.eventEmitter.emit(
        DomainEvents.RISK_ASSESSMENT_COMPLETED,
        completedPayload,
      );

      const recommendationPayload: DecisionRecommendationCreatedEvent = {
        decisionRecommendationId: decisionRecommendation.id,
        riskAssessmentId: riskAssessment.id,
        hazardEventId,
        hazardType: resolvedHazardType,
        districtId,
        districtName: district.name,
        priorityLevel: priorityResult.priorityLevel,
        priorityScore: priorityResult.priorityScore,
        exposureLevel: predictResult.exposureLevel,
        estimatedAffectedPopulation: predictResult.estimatedAffectedPopulation,
      };
      this.eventEmitter.emit(
        DomainEvents.DECISION_RECOMMENDATION_CREATED,
        recommendationPayload,
      );
    } catch (error) {
      const reason = (error as Error).message;
      this.logger.error(
        `Risk engine pipeline failed for hazardEvent=${hazardEventId ?? 'baseline'} district=${districtId}: ${reason}`,
      );

      if (riskAssessmentId) {
        await this.riskAssessmentRepository.update(riskAssessmentId, {
          status: RiskAssessmentStatus.FAILED,
          errorMessage: reason,
        });
      }

      const payload: RiskAssessmentFailedEvent = {
        hazardEventId,
        districtId,
        hazardType,
        reason,
      };
      this.eventEmitter.emit(DomainEvents.RISK_ASSESSMENT_FAILED, payload);
    }
  }
}
