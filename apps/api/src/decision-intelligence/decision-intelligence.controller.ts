import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DecisionIntelligenceService } from './decision-intelligence.service';
import { QueryDecisionRecommendationsDto } from './dto/query-decision-recommendations.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

// JwtAuthGuard only — any authenticated analyst/agency user
// (docs/API_SPEC.md's guard posture table).
@ApiTags('decision-intelligence')
@ApiBearerAuth()
@Controller('decision-recommendations')
@UseGuards(JwtAuthGuard)
export class DecisionIntelligenceController {
  constructor(
    private readonly decisionIntelligenceService: DecisionIntelligenceService,
  ) {}

  @Get()
  findAll(@Query() query: QueryDecisionRecommendationsDto) {
    return this.decisionIntelligenceService.findAll({
      priorityLevel: query.priorityLevel,
      hazardType: query.hazardType,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.decisionIntelligenceService.findOne(id);
  }
}
