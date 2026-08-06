import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HistoricalService } from './historical.service';
import { CreateHistoricalDisasterDto } from './dto/create-historical-disaster.dto';
import { UpdateHistoricalDisasterDto } from './dto/update-historical-disaster.dto';
import { QueryHistoricalDto } from './dto/query-historical.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('historical')
@ApiBearerAuth()
@Controller('historical')
export class HistoricalController {
  constructor(
    private readonly historicalService: HistoricalService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  findAll(@Query() query: QueryHistoricalDto) {
    return this.historicalService.findAll({
      hazardType: query.hazardType,
      province: query.province,
      district: query.district,
      minMagnitude: query.minMagnitude,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.historicalService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async create(
    @Body() dto: CreateHistoricalDisasterDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const record = await this.historicalService.create(dto, actor.id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'historical.create',
      targetType: 'historical_disaster',
      targetId: record.id,
    });
    return record;
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHistoricalDisasterDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const record = await this.historicalService.update(id, dto);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'historical.update',
      targetType: 'historical_disaster',
      targetId: id,
      metadata: { ...dto },
    });
    return record;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.historicalService.remove(id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'historical.delete',
      targetType: 'historical_disaster',
      targetId: id,
    });
  }
}
