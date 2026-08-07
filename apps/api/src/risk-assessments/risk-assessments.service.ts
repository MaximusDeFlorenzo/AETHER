import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskAssessment } from '../database/entities';
import { HazardType } from '../common/enums/domain.enum';

@Injectable()
export class RiskAssessmentsService {
  constructor(
    @InjectRepository(RiskAssessment)
    private readonly riskAssessmentRepository: Repository<RiskAssessment>,
  ) {}

  async findAll(filters: {
    hazardType?: HazardType;
    district?: string;
    minRiskScore?: number;
    baseline?: boolean;
    page: number;
    limit: number;
  }) {
    const qb = this.riskAssessmentRepository
      .createQueryBuilder('ra')
      .leftJoinAndSelect('ra.district', 'district')
      .leftJoinAndSelect('ra.hazardEvent', 'hazardEvent')
      .orderBy('ra.assessedAt', 'DESC');

    if (filters.hazardType) {
      qb.andWhere('ra.hazardType = :hazardType', {
        hazardType: filters.hazardType,
      });
    }
    if (filters.district) {
      qb.andWhere('district.id = :district', { district: filters.district });
    }
    if (filters.minRiskScore !== undefined) {
      qb.andWhere('ra.riskScore >= :minRiskScore', {
        minRiskScore: filters.minRiskScore,
      });
    }
    if (filters.baseline !== undefined) {
      qb.andWhere(
        filters.baseline
          ? 'ra.hazardEvent IS NULL'
          : 'ra.hazardEvent IS NOT NULL',
      );
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { data, meta: { page: filters.page, limit: filters.limit, total } };
  }

  async findOne(id: string): Promise<RiskAssessment> {
    const assessment = await this.riskAssessmentRepository.findOne({
      where: { id },
      relations: { district: true, hazardEvent: true },
    });
    if (!assessment) {
      throw new NotFoundException('Risk assessment not found');
    }
    return assessment;
  }
}
