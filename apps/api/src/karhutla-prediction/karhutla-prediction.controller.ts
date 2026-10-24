import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { KarhutlaPredictionService } from './karhutla-prediction.service';
import { KarhutlaRunTrigger } from './karhutla.enums';
import { CreateKarhutlaRunDto } from './dto/create-karhutla-run.dto';
import { QueryKarhutlaRunsDto } from './dto/query-karhutla-runs.dto';

// Authenticated workspace only (unlike the public hazard-event feed): these
// are unvalidated model outputs meant for trained operators, not the
// citizen portal. Any signed-in role may read; only admins and agency
// operators may spend provider quota on a new run.
@ApiTags('karhutla')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('karhutla/predictions')
export class KarhutlaPredictionController {
  constructor(
    private readonly service: KarhutlaPredictionService,
    private readonly auditService: AuditService,
  ) {}

  @Get('latest')
  latest() {
    return this.service.getLatest();
  }

  @Get('runs')
  listRuns(@Query() query: QueryKarhutlaRunsDto) {
    return this.service.listRuns(query.limit);
  }

  @Get('runs/:id')
  getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getRun(id);
  }

  @Get('runs/:id/verification')
  verifyRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.verifyRun(id);
  }

  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async requestRun(
    @Body() dto: CreateKarhutlaRunDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const result = await this.service.requestRun({
      trigger: KarhutlaRunTrigger.MANUAL,
      userId: actor.id,
      horizonsHours: dto.horizonsHours,
      maxClusters: dto.maxClusters,
    });
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'karhutla.prediction.request',
      targetType: 'karhutla_prediction_run',
      targetId: result.run.id,
      metadata: { deduplicated: result.deduplicated, ...dto },
    });
    return result;
  }
}
