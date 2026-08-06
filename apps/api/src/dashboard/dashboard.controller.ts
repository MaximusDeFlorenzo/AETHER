import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { QueryAnalyticsDto } from './dto/query-analytics.dto';

@ApiTags('dashboard')
@Controller()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('dashboard')
  getSummary() {
    return this.dashboardService.getSummary();
  }

  @Get('analytics')
  getAnalytics(@Query() query: QueryAnalyticsDto) {
    return this.dashboardService.getAnalytics(query);
  }
}
