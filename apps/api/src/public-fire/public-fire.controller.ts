import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HotspotMapQueryDto,
  HotspotPointsQueryDto,
  SmokeQueryDto,
} from './dto/public-fire.dto';
import { HotspotMapService } from './hotspot-map.service';
import { SmokeMapService } from './smoke-map.service';

const MAX_BBOX_SIDE_DEG = 10;

// No guard — read-only satellite observations for the anonymous citizen
// portal, same posture as PublicPortalController.
@ApiTags('public')
@Controller('public')
export class PublicFireController {
  constructor(
    private readonly hotspotMapService: HotspotMapService,
    private readonly smokeMapService: SmokeMapService,
  ) {}

  // Clustered FIRMS hotspots (MODIS + VIIRS), strongest first.
  @Get('hotspots')
  getHotspots(@Query() query: HotspotMapQueryDto) {
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      throw new BadRequestException('lat and lng must be given together');
    }
    return this.hotspotMapService.getMap({
      hours: query.hours,
      limit: query.limit,
      near:
        query.lat !== undefined && query.lng !== undefined
          ? { latitude: query.lat, longitude: query.lng }
          : undefined,
    });
  }

  // Individual detections in a viewport, for the zoomed-in map.
  @Get('hotspots/points')
  getHotspotPoints(@Query() query: HotspotPointsQueryDto) {
    const [west, south, east, north] = query.bbox.split(',').map(Number);
    if (
      west >= east ||
      south >= north ||
      Math.abs(south) > 90 ||
      Math.abs(north) > 90 ||
      Math.abs(west) > 180 ||
      Math.abs(east) > 180
    ) {
      throw new BadRequestException(
        'bbox must be a valid west,south,east,north',
      );
    }
    if (east - west > MAX_BBOX_SIDE_DEG || north - south > MAX_BBOX_SIDE_DEG) {
      throw new BadRequestException(
        `bbox may span at most ${MAX_BBOX_SIDE_DEG}° per side`,
      );
    }
    return this.hotspotMapService.getPoints(query.hours, [
      west,
      south,
      east,
      north,
    ]);
  }

  // Latest karhutla smoke forecast: one horizon per fire for the map, plus
  // whether (and when) the smoke reaches the citizen's location.
  @Get('smoke/latest')
  getSmoke(@Query() query: SmokeQueryDto) {
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      throw new BadRequestException('lat and lng must be given together');
    }
    return this.smokeMapService.getLatest(
      query.hours,
      query.lat !== undefined && query.lng !== undefined
        ? { latitude: query.lat, longitude: query.lng }
        : undefined,
    );
  }
}
