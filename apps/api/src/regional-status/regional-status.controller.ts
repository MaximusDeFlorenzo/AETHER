import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RegionalStatusService } from './regional-status.service';
import {
  CreateRegionalStatusDto,
  PublicRegionalStatusQueryDto,
  QueryRegionalStatusesDto,
  UpdateRegionalStatusDto,
} from './dto/regional-status.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

// Operator side: recording a Pemda's official emergency status is a human
// act (copying a decree into the system), audited like public alarms.
@ApiTags('regional-statuses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
@Controller('regional-statuses')
export class RegionalStatusController {
  constructor(
    private readonly regionalStatusService: RegionalStatusService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  findAll(@Query() query: QueryRegionalStatusesDto) {
    return this.regionalStatusService.findAllForOperators(
      query.page,
      query.limit,
    );
  }

  @Post()
  async create(
    @Body() dto: CreateRegionalStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const status = await this.regionalStatusService.create(dto, actor.id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'regional_statuses.create',
      targetType: 'regional_emergency_status',
      targetId: status.id,
      metadata: {
        district: status.district.name,
        phase: status.phase,
        hazard: status.hazard,
        endsOn: status.endsOn,
      },
    });
    return status;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegionalStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const status = await this.regionalStatusService.update(id, dto);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'regional_statuses.update',
      targetType: 'regional_emergency_status',
      targetId: status.id,
      metadata: { ...dto },
    });
    return status;
  }

  @Post(':id/end')
  async end(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const status = await this.regionalStatusService.end(id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'regional_statuses.end',
      targetType: 'regional_emergency_status',
      targetId: status.id,
    });
    return status;
  }
}

// Anonymous, like the rest of /public: only what a decree already makes
// public — no operator identities.
@ApiTags('public')
@Controller('public')
export class PublicRegionalStatusController {
  constructor(private readonly regionalStatusService: RegionalStatusService) {}

  @Get('regional-status')
  findActive(@Query() query: PublicRegionalStatusQueryDto) {
    return this.regionalStatusService.findActiveForDistrict(query.district);
  }
}
