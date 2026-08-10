import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DecisionRecommendation } from '../database/entities';
import { HazardType, PriorityLevel } from '../common/enums/domain.enum';

@Injectable()
export class DecisionIntelligenceService {
  constructor(
    @InjectRepository(DecisionRecommendation)
    private readonly decisionRecommendationRepository: Repository<DecisionRecommendation>,
  ) {}

  async findAll(filters: {
    priorityLevel?: PriorityLevel;
    hazardType?: HazardType;
    hazardEventId?: string;
    page: number;
    limit: number;
  }) {
    const qb = this.decisionRecommendationRepository
      .createQueryBuilder('rec')
      .leftJoinAndSelect('rec.riskAssessment', 'riskAssessment')
      .leftJoinAndSelect('riskAssessment.district', 'district')
      .leftJoinAndSelect('riskAssessment.hazardEvent', 'hazardEvent')
      .orderBy('rec.priorityScore', 'DESC');

    if (filters.priorityLevel) {
      qb.andWhere('rec.priorityLevel = :priorityLevel', {
        priorityLevel: filters.priorityLevel,
      });
    }
    if (filters.hazardType) {
      qb.andWhere('riskAssessment.hazardType = :hazardType', {
        hazardType: filters.hazardType,
      });
    }
    if (filters.hazardEventId) {
      qb.andWhere('hazardEvent.id = :hazardEventId', {
        hazardEventId: filters.hazardEventId,
      });
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { data, meta: { page: filters.page, limit: filters.limit, total } };
  }

  async findOne(id: string): Promise<DecisionRecommendation> {
    const recommendation = await this.decisionRecommendationRepository.findOne({
      where: { id },
      relations: {
        riskAssessment: { district: true, hazardEvent: true },
      },
    });
    if (!recommendation) {
      throw new NotFoundException('Decision recommendation not found');
    }
    return recommendation;
  }
}
