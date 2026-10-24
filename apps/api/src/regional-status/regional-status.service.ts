import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { District, RegionalEmergencyStatus } from '../database/entities';
import { PublicAlertHazard } from '../public-alerts/public-alert.enums';
import { EmergencyPhase } from './emergency-phase.enum';
import {
  CreateRegionalStatusDto,
  UpdateRegionalStatusDto,
} from './dto/regional-status.dto';

// Decrees are dated in local calendar days; WIB is the earliest-ending
// Indonesian zone, so a status never lapses early anywhere in the country.
const LOCAL_TODAY_SQL = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;

export interface RegionalStatusView {
  id: string;
  phase: EmergencyPhase;
  hazard: PublicAlertHazard;
  startsOn: string;
  endsOn: string;
  decreeNumber: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  note: string | null;
  district: { id: string; name: string };
  endedAt: string | null;
  updatedAt: string;
}

@Injectable()
export class RegionalStatusService {
  constructor(
    @InjectRepository(RegionalEmergencyStatus)
    private readonly statusRepository: Repository<RegionalEmergencyStatus>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
  ) {}

  static toView(status: RegionalEmergencyStatus): RegionalStatusView {
    return {
      id: status.id,
      phase: status.phase,
      hazard: status.hazard,
      startsOn: status.startsOn,
      endsOn: status.endsOn,
      decreeNumber: status.decreeNumber,
      sourceLabel: status.sourceLabel,
      sourceUrl: status.sourceUrl,
      note: status.note,
      district: { id: status.district.id, name: status.district.name },
      endedAt: status.endedAt?.toISOString() ?? null,
      updatedAt: status.updatedAt.toISOString(),
    };
  }

  /** In force today for this district: started, not past ends_on, not revoked. */
  async findActiveForDistrict(
    districtId: string,
  ): Promise<RegionalStatusView[]> {
    const rows = await this.statusRepository
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.district', 'district')
      .where('district.id = :districtId', { districtId })
      .andWhere('s.ended_at IS NULL')
      .andWhere(`s.starts_on <= ${LOCAL_TODAY_SQL}`)
      .andWhere(`s.ends_on >= ${LOCAL_TODAY_SQL}`)
      .orderBy('s.ends_on', 'DESC')
      .getMany();
    return rows.map((row) => RegionalStatusService.toView(row));
  }

  async findAllForOperators(page: number, limit: number) {
    const [rows, total] = await this.statusRepository.findAndCount({
      relations: { district: true, createdBy: true },
      order: { endsOn: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: rows.map((row) => ({
        ...RegionalStatusService.toView(row),
        createdByName: row.createdBy?.fullName ?? null,
      })),
      meta: { page, limit, total },
    };
  }

  async create(
    dto: CreateRegionalStatusDto,
    actorUserId: string,
  ): Promise<RegionalStatusView> {
    RegionalStatusService.assertDateOrder(dto.startsOn, dto.endsOn);
    const district = await this.districtRepository.findOne({
      where: { id: dto.districtId },
    });
    if (!district) throw new NotFoundException('District not found');

    const saved = await this.statusRepository.save(
      this.statusRepository.create({
        district,
        phase: dto.phase,
        hazard: dto.hazard,
        startsOn: dto.startsOn,
        endsOn: dto.endsOn,
        decreeNumber: dto.decreeNumber?.trim() || null,
        sourceLabel: dto.sourceLabel.trim(),
        sourceUrl: dto.sourceUrl?.trim() || null,
        note: dto.note?.trim() || null,
        createdBy: { id: actorUserId },
      }),
    );
    return RegionalStatusService.toView(await this.findOneOrFail(saved.id));
  }

  async update(
    id: string,
    dto: UpdateRegionalStatusDto,
  ): Promise<RegionalStatusView> {
    const status = await this.findOneOrFail(id);
    const startsOn = dto.startsOn ?? status.startsOn;
    const endsOn = dto.endsOn ?? status.endsOn;
    RegionalStatusService.assertDateOrder(startsOn, endsOn);

    status.startsOn = startsOn;
    status.endsOn = endsOn;
    if (dto.phase) status.phase = dto.phase;
    if (dto.sourceLabel !== undefined)
      status.sourceLabel = dto.sourceLabel.trim();
    if (dto.decreeNumber !== undefined)
      status.decreeNumber = dto.decreeNumber.trim() || null;
    if (dto.sourceUrl !== undefined)
      status.sourceUrl = dto.sourceUrl.trim() || null;
    if (dto.note !== undefined) status.note = dto.note.trim() || null;
    await this.statusRepository.save(status);
    return RegionalStatusService.toView(await this.findOneOrFail(id));
  }

  async end(id: string): Promise<RegionalStatusView> {
    const status = await this.findOneOrFail(id);
    if (!status.endedAt) {
      status.endedAt = new Date();
      await this.statusRepository.save(status);
    }
    return RegionalStatusService.toView(status);
  }

  private async findOneOrFail(id: string) {
    const status = await this.statusRepository.findOne({
      where: { id },
      relations: { district: true },
    });
    if (!status) throw new NotFoundException('Regional status not found');
    return status;
  }

  private static assertDateOrder(startsOn: string, endsOn: string) {
    if (endsOn < startsOn) {
      throw new BadRequestException('endsOn must be on or after startsOn');
    }
  }
}
