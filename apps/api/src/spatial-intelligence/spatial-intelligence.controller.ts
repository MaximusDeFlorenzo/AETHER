import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SpatialIntelligenceService } from './spatial-intelligence.service';
import { QuerySpatialOverlayDto } from './dto/query-spatial-overlay.dto';

// No guard — public risk-intelligence surface (docs/API_SPEC.md's guard
// posture table lists `GET /spatial/overlay` alongside `GET /hazard-events`
// and `GET /sustainability-metrics` as unauthenticated).
@ApiTags('spatial-intelligence')
@Controller('spatial')
export class SpatialIntelligenceController {
  constructor(
    private readonly spatialIntelligenceService: SpatialIntelligenceService,
  ) {}

  @Get('overlay')
  getOverlay(@Query() query: QuerySpatialOverlayDto) {
    return this.spatialIntelligenceService.getOverlay(
      query.layer,
      query.hazardType,
      query.bbox,
    );
  }
}
