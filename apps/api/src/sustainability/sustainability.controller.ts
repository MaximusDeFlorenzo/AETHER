import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SustainabilityService } from './sustainability.service';
import { QuerySustainabilityMetricsDto } from './dto/query-sustainability-metrics.dto';

// No guard — public accountability dashboard, same posture as ORION's
// public command-center dashboard (docs/API_SPEC.md §8).
@ApiTags('sustainability')
@Controller('sustainability-metrics')
export class SustainabilityController {
  constructor(private readonly sustainabilityService: SustainabilityService) {}

  @Get()
  getMetrics(@Query() query: QuerySustainabilityMetricsDto) {
    return this.sustainabilityService.getMetrics(query);
  }
}
