import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DecisionIntelligenceService } from './decision-intelligence.service';
import { QueryDecisionRecommendationsDto } from './dto/query-decision-recommendations.dto';

// No guard — public read-only risk-intelligence surface (docs/API_SPEC.md
// §"Auth guard posture").
@ApiTags('decision-intelligence')
@Controller('decision-recommendations')
export class DecisionIntelligenceController {
  constructor(
    private readonly decisionIntelligenceService: DecisionIntelligenceService,
  ) {}

  @Get()
  findAll(@Query() query: QueryDecisionRecommendationsDto) {
    return this.decisionIntelligenceService.findAll({
      priorityLevel: query.priorityLevel,
      hazardType: query.hazardType,
      hazardEventId: query.hazardEventId,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.decisionIntelligenceService.findOne(id);
  }
}
