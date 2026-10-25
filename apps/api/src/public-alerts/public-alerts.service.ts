import { EventEmitter2 } from '@nestjs/event-emitter';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HazardEvent,
  PublicAlert,
  PublicAlertResponse,
  User,
} from '../database/entities';
import {
  HelpRequestHandling,
  PublicAlertLevel,
  PublicAlertResponseStatus,
  PublicAlertStatus,
} from './public-alert.enums';
import { PublicAreaResolver } from './public-area.resolver';
import { WebPushService } from './web-push.service';
import type {
  AreaQueryDto,
  CreateAlertResponseDto,
  CreatePublicAlertDto,
} from './dto/public-alert.dto';
import {
  DomainEvents,
  type CitizenHelpRequestedEvent,
} from '../common/events/domain-events';

const HOUR_MS = 60 * 60 * 1000;

export interface PublicAlertView {
  id: string;
  hazard: PublicAlert['hazard'];
  level: PublicAlert['level'];
  status: PublicAlertStatus;
  isActive: boolean;
  title: string;
  action: string;
  message: string;
  destinationName: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  avoidText: string | null;
  sourceLabel: string;
  area: {
    districtId: string;
    districtName: string;
    subdistrictId: string | null;
    subdistrictName: string | null;
    villageId: string | null;
    villageName: string | null;
  };
  createdAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

export interface AutomaticAlertInput {
  hazard: PublicAlert['hazard'];
  level: PublicAlert['level'];
  title: string;
  action: string;
  message: string;
  avoidText: string | null;
  sourceLabel: string;
  districtId: string;
  hazardEventId: string;
  expiresInHours: number;
}

export interface ResponseCounts {
  safe: number;
  /** "Butuh bantuan" requests no officer has acted on yet. */
  needsHelp: number;
  /** Help requests with a team on the way. */
  helpDispatched: number;
  /** Help requests closed as safe / evacuated. */
  helpResolved: number;
}

@Injectable()
export class PublicAlertsService {
  private readonly logger = new Logger(PublicAlertsService.name);

  constructor(
    @InjectRepository(PublicAlert)
    private readonly alertRepository: Repository<PublicAlert>,
    @InjectRepository(PublicAlertResponse)
    private readonly responseRepository: Repository<PublicAlertResponse>,
    private readonly areaResolver: PublicAreaResolver,
    private readonly webPushService: WebPushService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  static isActive(alert: PublicAlert, now = new Date()): boolean {
    return alert.status === PublicAlertStatus.ACTIVE && alert.expiresAt > now;
  }

  static toView(alert: PublicAlert): PublicAlertView {
    return {
      id: alert.id,
      hazard: alert.hazard,
      level: alert.level,
      status: alert.status,
      isActive: PublicAlertsService.isActive(alert),
      title: alert.title,
      action: alert.action,
      message: alert.message,
      destinationName: alert.destinationName,
      destinationLatitude: alert.destinationLatitude,
      destinationLongitude: alert.destinationLongitude,
      avoidText: alert.avoidText,
      sourceLabel: alert.sourceLabel,
      area: {
        districtId: alert.district.id,
        districtName: alert.district.name,
        subdistrictId: alert.subdistrict?.id ?? null,
        subdistrictName: alert.subdistrict?.name ?? null,
        villageId: alert.village?.id ?? null,
        villageName: alert.village?.name ?? null,
      },
      createdAt: alert.createdAt,
      expiresAt: alert.expiresAt,
      endedAt: alert.endedAt,
    };
  }

  async create(
    dto: CreatePublicAlertDto,
    actorId: string,
  ): Promise<PublicAlertView> {
    const area = await this.areaResolver.resolve(
      dto.districtId,
      dto.subdistrictId,
      dto.villageId,
    );
    const alert = this.alertRepository.create({
      hazard: dto.hazard,
      level: dto.level ?? PublicAlertLevel.AWAS,
      status: PublicAlertStatus.ACTIVE,
      title: dto.title.trim(),
      action: dto.action.trim(),
      message: dto.message.trim(),
      destinationName: dto.destinationName?.trim() || null,
      destinationLatitude: dto.destinationLatitude ?? null,
      destinationLongitude: dto.destinationLongitude ?? null,
      avoidText: dto.avoidText?.trim() || null,
      sourceLabel: dto.sourceLabel.trim(),
      district: area.district,
      subdistrict: area.subdistrict,
      village: area.village,
      hazardEvent: dto.hazardEventId
        ? ({ id: dto.hazardEventId } as HazardEvent)
        : null,
      createdBy: { id: actorId } as User,
      expiresAt: new Date(Date.now() + dto.expiresInHours * HOUR_MS),
    });
    const saved = await this.alertRepository.save(alert);
    this.dispatchPush(saved);
    return PublicAlertsService.toView(saved);
  }

  /**
   * District-wide alert raised by AETHER itself rather than an operator —
   * only for relaying an official warning (see BmkgAutoAlertService), so
   * there is no creator and no evacuation destination.
   */
  async issueAutomatic(input: AutomaticAlertInput): Promise<PublicAlert> {
    const area = await this.areaResolver.resolve(input.districtId);
    const alert = this.alertRepository.create({
      hazard: input.hazard,
      level: input.level,
      status: PublicAlertStatus.ACTIVE,
      title: input.title,
      action: input.action,
      message: input.message,
      destinationName: null,
      destinationLatitude: null,
      destinationLongitude: null,
      avoidText: input.avoidText,
      sourceLabel: input.sourceLabel,
      district: area.district,
      subdistrict: null,
      village: null,
      hazardEvent: { id: input.hazardEventId } as HazardEvent,
      createdBy: null,
      expiresAt: new Date(Date.now() + input.expiresInHours * HOUR_MS),
    });
    const saved = await this.alertRepository.save(alert);
    this.dispatchPush(saved);
    return saved;
  }

  async existsForHazardEvent(hazardEventId: string): Promise<boolean> {
    return this.alertRepository.exists({
      where: { hazardEvent: { id: hazardEventId } },
    });
  }

  // Fire-and-forget: the issuer shouldn't wait on thousands of push
  // round-trips, and a push failure must never roll back the alert itself
  // (open browser tabs still pick it up by polling).
  private dispatchPush(alert: PublicAlert): void {
    this.webPushService.sendAlert(alert).catch((error: Error) => {
      this.logger.error(
        `Push fan-out for alert ${alert.id} failed: ${error.message}`,
      );
    });
  }

  async findActiveForArea(query: AreaQueryDto): Promise<PublicAlertView[]> {
    const qb = this.alertRepository
      .createQueryBuilder('alert')
      .leftJoinAndSelect('alert.district', 'district')
      .leftJoinAndSelect('alert.subdistrict', 'subdistrict')
      .leftJoinAndSelect('alert.village', 'village')
      .where('alert.status = :status', { status: PublicAlertStatus.ACTIVE })
      .andWhere('alert.expires_at > now()')
      .andWhere('alert.district_id = :district', { district: query.district })
      .orderBy('alert.created_at', 'DESC');
    // Same "coarser area is included" rule as WebPushService.findRecipients,
    // applied from the viewer's side.
    if (query.subdistrict) {
      qb.andWhere(
        '(alert.subdistrict_id IS NULL OR alert.subdistrict_id = :subdistrict)',
        {
          subdistrict: query.subdistrict,
        },
      );
    }
    if (query.village) {
      qb.andWhere('(alert.village_id IS NULL OR alert.village_id = :village)', {
        village: query.village,
      });
    }
    const alerts = await qb.getMany();
    return alerts.map((alert) => PublicAlertsService.toView(alert));
  }

  async findOneView(id: string): Promise<PublicAlertView> {
    return PublicAlertsService.toView(await this.findOneOrThrow(id));
  }

  async findAllForOperators(page: number, limit: number) {
    const [alerts, total] = await this.alertRepository.findAndCount({
      relations: {
        district: true,
        subdistrict: true,
        village: true,
        createdBy: true,
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const counts = await this.countResponses(alerts.map((alert) => alert.id));
    return {
      data: alerts.map((alert) => ({
        ...PublicAlertsService.toView(alert),
        createdByName: alert.createdBy?.fullName ?? null,
        pushSentCount: alert.pushSentCount,
        pushFailedCount: alert.pushFailedCount,
        responses: counts.get(alert.id) ?? {
          safe: 0,
          needsHelp: 0,
          helpDispatched: 0,
          helpResolved: 0,
        },
      })),
      meta: { page, limit, total },
    };
  }

  async end(id: string): Promise<PublicAlertView> {
    const alert = await this.findOneOrThrow(id);
    if (alert.status !== PublicAlertStatus.ENDED) {
      alert.status = PublicAlertStatus.ENDED;
      alert.endedAt = new Date();
      await this.alertRepository.save(alert);
    }
    return PublicAlertsService.toView(alert);
  }

  async respond(
    alertId: string,
    dto: CreateAlertResponseDto,
  ): Promise<{ status: PublicAlertResponseStatus }> {
    const alert = await this.findOneOrThrow(alertId);
    const existing = await this.responseRepository.findOne({
      where: { alert: { id: alert.id }, deviceId: dto.deviceId },
    });
    const row =
      existing ??
      this.responseRepository.create({ alert, deviceId: dto.deviceId });
    const newHelpRequest =
      dto.status === PublicAlertResponseStatus.NEEDS_HELP &&
      existing?.status !== PublicAlertResponseStatus.NEEDS_HELP;
    row.status = dto.status;
    // Keep previously shared location/details if a later answer omits them
    // (live location updates resend only the coordinates).
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      row.latitude = dto.latitude;
      row.longitude = dto.longitude;
    }
    // Asking for help again reopens a request an officer had handled.
    if (newHelpRequest) {
      row.handling = null;
      row.handledAt = null;
      row.handledBy = null;
    }
    if (dto.peopleCount !== undefined) row.peopleCount = dto.peopleCount;
    if (dto.note !== undefined) row.note = dto.note.trim() || null;
    if (dto.contactPhone !== undefined)
      row.contactPhone = dto.contactPhone.trim() || null;
    await this.responseRepository.save(row);
    if (newHelpRequest) {
      const event: CitizenHelpRequestedEvent = {
        alertId: alert.id,
        alertTitle: alert.title,
        areaName:
          alert.village?.name ?? alert.subdistrict?.name ?? alert.district.name,
        hasLocation: row.latitude !== null && row.longitude !== null,
      };
      this.eventEmitter.emit(DomainEvents.CITIZEN_HELP_REQUESTED, event);
    }
    return { status: row.status };
  }

  async findResponses(alertId: string) {
    const alert = await this.findOneOrThrow(alertId);
    const rows = await this.responseRepository.find({
      where: { alert: { id: alert.id } },
      relations: { handledBy: true },
      order: { createdAt: 'ASC' },
    });
    const counts = (await this.countResponses([alert.id])).get(alert.id) ?? {
      safe: 0,
      needsHelp: 0,
      helpDispatched: 0,
      helpResolved: 0,
    };
    return {
      counts,
      needsHelp: rows
        .filter((row) => row.status === PublicAlertResponseStatus.NEEDS_HELP)
        .map((row) => ({
          id: row.id,
          latitude: row.latitude,
          longitude: row.longitude,
          peopleCount: row.peopleCount,
          note: row.note,
          contactPhone: row.contactPhone,
          handling: row.handling,
          handledAt: row.handledAt,
          handledByName: row.handledBy?.fullName ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
    };
  }

  /** Officer progress on a help request: team dispatched, or person safe. */
  async setHelpHandling(
    alertId: string,
    responseId: string,
    handling: HelpRequestHandling,
    actorId: string,
  ) {
    const row = await this.responseRepository.findOne({
      where: { id: responseId, alert: { id: alertId } },
    });
    if (!row || row.status !== PublicAlertResponseStatus.NEEDS_HELP) {
      throw new NotFoundException(`Help request ${responseId} not found`);
    }
    row.handling = handling;
    row.handledAt = new Date();
    row.handledBy = { id: actorId } as User;
    await this.responseRepository.save(row);
    return { id: row.id, handling: row.handling, handledAt: row.handledAt };
  }

  private async countResponses(
    alertIds: string[],
  ): Promise<Map<string, ResponseCounts>> {
    const counts = new Map<string, ResponseCounts>();
    if (alertIds.length === 0) return counts;
    const rows = await this.responseRepository
      .createQueryBuilder('response')
      .select('response.alert_id', 'alertId')
      .addSelect('response.status', 'status')
      .addSelect('response.handling', 'handling')
      .addSelect('COUNT(*)::int', 'count')
      .where('response.alert_id IN (:...alertIds)', { alertIds })
      .groupBy('response.alert_id')
      .addGroupBy('response.status')
      .addGroupBy('response.handling')
      .getRawMany<{
        alertId: string;
        status: PublicAlertResponseStatus;
        handling: HelpRequestHandling | null;
        count: number;
      }>();
    for (const row of rows) {
      const entry = counts.get(row.alertId) ?? {
        safe: 0,
        needsHelp: 0,
        helpDispatched: 0,
        helpResolved: 0,
      };
      const count = Number(row.count);
      if (row.status === PublicAlertResponseStatus.SAFE) entry.safe += count;
      else if (row.handling === HelpRequestHandling.RESOLVED)
        entry.helpResolved += count;
      else if (row.handling === HelpRequestHandling.DISPATCHED)
        entry.helpDispatched += count;
      else entry.needsHelp += count;
      counts.set(row.alertId, entry);
    }
    return counts;
  }

  private async findOneOrThrow(id: string): Promise<PublicAlert> {
    const alert = await this.alertRepository.findOne({
      where: { id },
      relations: { district: true, subdistrict: true, village: true },
    });
    if (!alert) throw new NotFoundException(`Public alert ${id} not found`);
    return alert;
  }
}
