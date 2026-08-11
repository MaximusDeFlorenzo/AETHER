import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import {
  District,
  HazardEvent,
  ResourceOptimizationPlan,
  RiskAssessment,
  Shelter,
} from '../database/entities';
import { RiskEngineClient } from '../risk-engine-orchestration/risk-engine.client';
import { DomainEvents } from '../common/events/domain-events';
import type {
  DecisionRecommendationCreatedEvent,
  ResourcePlanGeneratedEvent,
} from '../common/events/domain-events';
import { CreateResourceOptimizationPlanDto } from './dto/create-resource-optimization-plan.dto';
import { CreateShelterDto } from './dto/create-shelter.dto';

@Injectable()
export class ResourceOptimizationService {
  private readonly logger = new Logger(ResourceOptimizationService.name);

  constructor(
    @InjectRepository(ResourceOptimizationPlan)
    private readonly planRepository: Repository<ResourceOptimizationPlan>,
    @InjectRepository(Shelter)
    private readonly shelterRepository: Repository<Shelter>,
    private readonly riskEngineClient: RiskEngineClient,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Thin auto-generation trigger: once a decision recommendation's priority
   * score crosses RISK_NOTIFICATION_THRESHOLD, ask apps/ai-engine's
   * resource-optimization router for a plan and persist it as `draft`.
   * Best-effort — a failure here never blocks the decision-recommendation
   * pipeline that emitted this event.
   */
  @OnEvent(DomainEvents.DECISION_RECOMMENDATION_CREATED, { async: true })
  async handleDecisionRecommendationCreated(
    event: DecisionRecommendationCreatedEvent,
  ): Promise<void> {
    const threshold =
      this.config.get<number>('RISK_NOTIFICATION_THRESHOLD') ?? 60;
    if (event.priorityScore < threshold) {
      return;
    }

    try {
      const result = await this.riskEngineClient.optimizeResources({
        estimatedAffectedPopulation: event.estimatedAffectedPopulation ?? 0,
        exposureLevel: event.exposureLevel as
          'low' | 'moderate' | 'high' | 'severe',
      });

      const plan = await this.planRepository.save(
        this.planRepository.create({
          district: { id: event.districtId } as District,
          hazardEvent: event.hazardEventId
            ? ({ id: event.hazardEventId } as HazardEvent)
            : null,
          riskAssessment: { id: event.riskAssessmentId } as RiskAssessment,
          // ai-engine's /optimize-resources returns one comprehensive
          // estimate (hospital/ambulance/vehicles/volunteers/shelters/
          // logistics at once), not a single-category plan — 'evacuation'
          // is the closest umbrella category of the three this column
          // supports; the full breakdown lives in planDetails regardless.
          planType: 'evacuation',
          planDetails: result as unknown as Record<string, unknown>,
          estimatedPersonnelNeeded: result.volunteers.total,
          status: 'draft',
        }),
      );

      this.logger.log(
        `Auto-generated ${plan.planType} resource plan ${plan.id} for district ${event.districtId} (priority ${event.priorityScore})`,
      );

      const payload: ResourcePlanGeneratedEvent = {
        resourceOptimizationPlanId: plan.id,
        districtId: event.districtId,
        districtName: event.districtName,
        hazardEventId: event.hazardEventId,
        planType: plan.planType,
      };
      this.eventEmitter.emit(DomainEvents.RESOURCE_PLAN_GENERATED, payload);
    } catch (error) {
      this.logger.warn(
        `Resource optimization auto-generation failed for district=${event.districtId}: ${(error as Error).message}`,
      );
    }
  }

  async findAllPlans(filters: {
    district?: string;
    hazardType?: string;
    page: number;
    limit: number;
  }) {
    const qb = this.planRepository
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.district', 'district')
      .leftJoinAndSelect('plan.hazardEvent', 'hazardEvent')
      .orderBy('plan.createdAt', 'DESC');

    if (filters.district) {
      qb.andWhere('district.id = :district', { district: filters.district });
    }
    if (filters.hazardType) {
      qb.andWhere('hazardEvent.hazardType = :hazardType', {
        hazardType: filters.hazardType,
      });
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { data, meta: { page: filters.page, limit: filters.limit, total } };
  }

  async createPlan(
    dto: CreateResourceOptimizationPlanDto,
  ): Promise<ResourceOptimizationPlan> {
    const plan = this.planRepository.create({
      district: { id: dto.districtId } as District,
      hazardEvent: dto.hazardEventId
        ? ({ id: dto.hazardEventId } as HazardEvent)
        : null,
      riskAssessment: dto.riskAssessmentId
        ? ({ id: dto.riskAssessmentId } as RiskAssessment)
        : null,
      planType: dto.planType,
      planDetails: dto.planDetails,
      estimatedPersonnelNeeded: dto.estimatedPersonnelNeeded ?? null,
    });
    return this.planRepository.save(plan);
  }

  async findAllShelters(filters: { district?: string }): Promise<Shelter[]> {
    return this.shelterRepository.find({
      where: filters.district ? { district: { id: filters.district } } : {},
      relations: { district: true },
      order: { name: 'ASC' },
    });
  }

  async createShelter(dto: CreateShelterDto): Promise<Shelter> {
    const shelter = this.shelterRepository.create({
      district: { id: dto.districtId } as District,
      name: dto.name,
      geom: {
        type: 'Point',
        coordinates: [dto.longitude, dto.latitude],
      } as unknown as object,
      capacity: dto.capacity,
    });
    return this.shelterRepository.save(shelter);
  }

  async findOnePlan(id: string): Promise<ResourceOptimizationPlan> {
    const plan = await this.planRepository.findOne({
      where: { id },
      relations: { district: true, hazardEvent: true },
    });
    if (!plan) {
      throw new NotFoundException('Resource optimization plan not found');
    }
    return plan;
  }
}
