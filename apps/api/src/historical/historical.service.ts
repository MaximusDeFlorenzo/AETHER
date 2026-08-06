import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { District, HistoricalDisaster, Province } from '../database/entities';
import { HazardType } from '../common/enums/domain.enum';
import { CreateHistoricalDisasterDto } from './dto/create-historical-disaster.dto';
import { UpdateHistoricalDisasterDto } from './dto/update-historical-disaster.dto';

const MAGNITUDE_BAND_TOLERANCE = 1.5;

@Injectable()
export class HistoricalService {
  constructor(
    @InjectRepository(HistoricalDisaster)
    private readonly historicalRepository: Repository<HistoricalDisaster>,
  ) {}

  async findAll(filters: {
    hazardType?: HazardType;
    province?: string;
    district?: string;
    minMagnitude?: number;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const qb = this.historicalRepository
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.province', 'province')
      .leftJoinAndSelect('record.district', 'district')
      .orderBy('record.eventDate', 'DESC');

    if (filters.hazardType) {
      qb.andWhere('record.hazardType = :hazardType', {
        hazardType: filters.hazardType,
      });
    }
    if (filters.province) {
      qb.andWhere('province.id = :province', { province: filters.province });
    }
    if (filters.district) {
      qb.andWhere('district.id = :district', { district: filters.district });
    }
    if (filters.minMagnitude !== undefined) {
      qb.andWhere('record.magnitude >= :minMagnitude', {
        minMagnitude: filters.minMagnitude,
      });
    }
    if (filters.from) {
      qb.andWhere('record.eventDate >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('record.eventDate <= :to', { to: filters.to });
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { data, meta: { page: filters.page, limit: filters.limit, total } };
  }

  async findOne(id: string): Promise<HistoricalDisaster> {
    const record = await this.historicalRepository.findOne({
      where: { id },
      relations: { province: true, district: true },
    });
    if (!record) {
      throw new NotFoundException('Historical disaster record not found');
    }
    return record;
  }

  async create(
    dto: CreateHistoricalDisasterDto,
    createdById: string,
  ): Promise<HistoricalDisaster> {
    const record = this.historicalRepository.create({
      hazardType: dto.hazardType,
      province: { id: dto.provinceId } as Province,
      district: dto.districtId ? ({ id: dto.districtId } as District) : null,
      eventDate: dto.eventDate,
      magnitude: dto.magnitude ?? null,
      casualtiesDead: dto.casualtiesDead ?? 0,
      casualtiesInjured: dto.casualtiesInjured ?? 0,
      casualtiesMissing: dto.casualtiesMissing ?? 0,
      displacedPopulation: dto.displacedPopulation ?? 0,
      damagedBuildingsCount: dto.damagedBuildingsCount ?? 0,
      damageDescription: dto.damageDescription ?? null,
      createdBy: { id: createdById } as any,
    });
    return this.historicalRepository.save(record);
  }

  async update(
    id: string,
    dto: UpdateHistoricalDisasterDto,
  ): Promise<HistoricalDisaster> {
    const record = await this.findOne(id);

    if (dto.hazardType !== undefined) record.hazardType = dto.hazardType;
    if (dto.provinceId !== undefined)
      record.province = { id: dto.provinceId } as Province;
    if (dto.districtId !== undefined)
      record.district = { id: dto.districtId } as District;
    if (dto.eventDate !== undefined) record.eventDate = dto.eventDate;
    if (dto.magnitude !== undefined) record.magnitude = dto.magnitude;
    if (dto.casualtiesDead !== undefined)
      record.casualtiesDead = dto.casualtiesDead;
    if (dto.casualtiesInjured !== undefined)
      record.casualtiesInjured = dto.casualtiesInjured;
    if (dto.casualtiesMissing !== undefined)
      record.casualtiesMissing = dto.casualtiesMissing;
    if (dto.displacedPopulation !== undefined)
      record.displacedPopulation = dto.displacedPopulation;
    if (dto.damagedBuildingsCount !== undefined)
      record.damagedBuildingsCount = dto.damagedBuildingsCount;
    if (dto.damageDescription !== undefined)
      record.damageDescription = dto.damageDescription;

    return this.historicalRepository.save(record);
  }

  async remove(id: string): Promise<void> {
    const record = await this.findOne(id);
    await this.historicalRepository.remove(record);
  }

  /**
   * Used by the risk-engine orchestration pipeline (historicalDisasters[]
   * input to `predict-risk`): records of the same hazard type in the same
   * province within a magnitude band of the current event, most severe
   * first. Non-earthquake hazards (no magnitude) fall back to recency.
   */
  async findRelevantForHazardEvent(
    hazardType: HazardType,
    provinceId: string,
    magnitude: number | null,
    limit = 5,
  ): Promise<HistoricalDisaster[]> {
    const qb = this.historicalRepository
      .createQueryBuilder('record')
      .where('record.hazardType = :hazardType', { hazardType })
      .andWhere('record.province = :provinceId', { provinceId });

    if (magnitude !== null) {
      qb.andWhere('record.magnitude BETWEEN :low AND :high', {
        low: magnitude - MAGNITUDE_BAND_TOLERANCE,
        high: magnitude + MAGNITUDE_BAND_TOLERANCE,
      }).orderBy('record.casualtiesDead', 'DESC');
    } else {
      qb.orderBy('record.eventDate', 'DESC');
    }

    return qb.take(limit).getMany();
  }
}
