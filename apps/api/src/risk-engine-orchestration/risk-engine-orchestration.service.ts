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
  async handleHazardEventCreated(event: HazardEventCreatedEvent): Promise<void> {
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
   * pipeline ORION never had. Periodically attempts every district for every
   * hazard type in `BASELINE_HAZARD_TYPES` with `hazardEvent = null`,
   * independent of any active event. In practice every attempt is currently
   * skipped by `buildHazardEventInput` (see its docstring) — there's no
   * per-hazard "typical conditions" data source yet to synthesize a
   * standing-risk input without a real event. The cron/loop stays in place
   * so wiring that data source later is a drop-in change, not a redesign.
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
   * Returns `null` (with a warning) if no concrete event was given (baseline
   * scan — there's no per-hazard "typical conditions" data source yet to
   * synthesize a standing-risk input without a real event) or if the
   * matching details row is missing/incomplete, which callers must treat as
   * "skip this district/hazard, don't call the AI engine."
   */
  private async buildHazardEventInput(
    hazardEvent: HazardEvent | null,
  ): Promise<RiskEngineHazardEventInput | null> {
    if (!hazardEvent) {
      return null;
    }

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
      if (!details || details.rainfallMm === null || details.waterLevelM === null) {
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
      if (!details || details.frpConfidence === null || details.hotspotCount === null) {
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

      const hazardEventInput = await this.buildHazardEventInput(hazardEvent);
      if (!hazardEventInput) {
        // Baseline scans (no concrete event) can't build a valid AI-engine
        // input yet (see buildHazardEventInput's docstring) — skip quietly
        // rather than writing a permanently-FAILED risk assessment every
        // 6 hours for every district/hazard-type combination.
        if (!hazardEventId) {
          this.logger.debug(
            `Skipping baseline scan for district=${districtId} hazardType=${hazardType}: ` +
              'no concrete event to build a valid AI-engine input from',
          );
        } else {
          this.logger.warn(
            `Skipping risk pipeline for hazardEvent=${hazardEventId}: ` +
              'matching *_details row is missing or incomplete',
          );
        }
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
      riskAssessment.exposureLevel = predictResult.exposureLevel as ExposureLevel;
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
