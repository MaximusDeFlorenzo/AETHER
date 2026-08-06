import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HazardEventsService } from './hazard-events.service';
import { IngestionRegistryService } from '../ingestion/ingestion-registry.service';
import { QueryHazardEventsDto } from './dto/query-hazard-events.dto';
import { ManualHazardEventDto } from './dto/manual-hazard-event.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('hazard-events')
@Controller('hazard-events')
export class HazardEventsController {
  constructor(
    private readonly hazardEventsService: HazardEventsService,
    private readonly ingestionRegistryService: IngestionRegistryService,
    private readonly auditService: AuditService,
  ) {}

  // No guard — public risk-intelligence surface (docs/API_SPEC.md §3, §8).
  @Get()
  findAll(@Query() query: QueryHazardEventsDto) {
    return this.hazardEventsService.findAll({
      hazardType: query.hazardType,
      minSeverity: query.minSeverity,
      from: query.from,
      to: query.to,
      province: query.province,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.hazardEventsService.findOne(id);
  }

  @Get(':id/relationships')
  findRelationships(@Param('id', ParseUUIDPipe) id: string) {
    return this.hazardEventsService.findRelationships(id);
  }

  @Post(':source/sync')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async sync(
    @Param('source') source: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const result = await this.ingestionRegistryService.triggerSync(source);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'hazard_events.sync.trigger',
      targetType: 'data_source',
      metadata: { source, ...result },
    });
    return { message: 'Sync triggered', source, ...result };
  }

  // Ground-truth reporting path (field_reporter role) — Phase 1's ingestion
  // route for hazard types with no live external adapter (landslide), and a
  // manual-override path for earthquake. See ManualHazardEventDto.
  @Post('manual')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR, RoleName.FIELD_REPORTER)
  async createManual(
    @Body() dto: ManualHazardEventDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const event = await this.hazardEventsService.createManual(dto);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'hazard_events.manual.create',
      targetType: 'hazard_event',
      targetId: event.id,
    });
    return event;
  }
}
