import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RiskAssessmentsService } from './risk-assessments.service';
import { QueryRiskAssessmentsDto } from './dto/query-risk-assessments.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

// JwtAuthGuard only — any authenticated analyst/agency user
// (docs/API_SPEC.md's guard posture table).
@ApiTags('risk-assessments')
@ApiBearerAuth()
@Controller('risk-assessments')
@UseGuards(JwtAuthGuard)
export class RiskAssessmentsController {
  constructor(private readonly riskAssessmentsService: RiskAssessmentsService) {}

  @Get()
  findAll(@Query() query: QueryRiskAssessmentsDto) {
    return this.riskAssessmentsService.findAll({
      hazardType: query.hazardType,
      district: query.district,
      minRiskScore: query.minRiskScore,
      baseline: query.baseline,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.riskAssessmentsService.findOne(id);
  }
}
