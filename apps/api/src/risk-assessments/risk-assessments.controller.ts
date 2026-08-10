import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RiskAssessmentsService } from './risk-assessments.service';
import { QueryRiskAssessmentsDto } from './dto/query-risk-assessments.dto';

// No guard — public read-only risk-intelligence surface (docs/API_SPEC.md
// §"Auth guard posture").
@ApiTags('risk-assessments')
@Controller('risk-assessments')
export class RiskAssessmentsController {
  constructor(
    private readonly riskAssessmentsService: RiskAssessmentsService,
  ) {}

  @Get()
  findAll(@Query() query: QueryRiskAssessmentsDto) {
    return this.riskAssessmentsService.findAll({
      hazardType: query.hazardType,
      district: query.district,
      hazardEventId: query.hazardEventId,
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
