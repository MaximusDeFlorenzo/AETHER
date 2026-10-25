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
import { PublicAlertsService } from './public-alerts.service';
import {
  CreatePublicAlertDto,
  QueryPublicAlertsDto,
  HandleHelpRequestDto,
} from './dto/public-alert.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

// Operator side of citizen alarms. Issuing one is always a human decision
// (admin / agency operator) — the risk engine can only surface candidates
// in the UI, never broadcast on its own.
@ApiTags('public-alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
@Controller('public-alerts')
export class PublicAlertsController {
  constructor(
    private readonly publicAlertsService: PublicAlertsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  findAll(@Query() query: QueryPublicAlertsDto) {
    return this.publicAlertsService.findAllForOperators(
      query.page,
      query.limit,
    );
  }

  @Post()
  async create(
    @Body() dto: CreatePublicAlertDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const alert = await this.publicAlertsService.create(dto, actor.id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'public_alerts.create',
      targetType: 'public_alert',
      targetId: alert.id,
      metadata: { hazard: alert.hazard, area: alert.area },
    });
    return alert;
  }

  @Post(':id/end')
  async end(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const alert = await this.publicAlertsService.end(id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'public_alerts.end',
      targetType: 'public_alert',
      targetId: alert.id,
    });
    return alert;
  }

  @Post(':id/responses/:responseId/handling')
  async setHelpHandling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('responseId', ParseUUIDPipe) responseId: string,
    @Body() dto: HandleHelpRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const result = await this.publicAlertsService.setHelpHandling(
      id,
      responseId,
      dto.handling,
      actor.id,
    );
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'public_alerts.help_handling',
      targetType: 'public_alert_response',
      targetId: responseId,
      metadata: { alertId: id, handling: dto.handling },
    });
    return result;
  }

  @Get(':id/responses')
  findResponses(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicAlertsService.findResponses(id);
  }
}
