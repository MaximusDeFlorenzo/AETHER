import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicAlertsService } from './public-alerts.service';
import { PublicAreaResolver } from './public-area.resolver';
import { PublicLocateService } from './public-locate.service';
import { WebPushService } from './web-push.service';
import {
  AirQualityService,
  MAX_AIR_QUALITY_POINTS,
} from './air-quality.service';
import {
  MAX_WIND_POINTS,
  PublicWeatherService,
} from './public-weather.service';
import {
  AreaQueryDto,
  CreateAlertResponseDto,
  CreatePushSubscriptionDto,
  RemovePushSubscriptionDto,
  LocateQueryDto,
  WindQueryDto,
} from './dto/public-alert.dto';

// No guard — the citizen portal is fully anonymous (no login to receive
// alarms or to say "I'm safe"). Nothing here returns operator identities,
// other citizens' responses, or subscription data.
@ApiTags('public')
@Controller('public')
export class PublicPortalController {
  constructor(
    private readonly publicAlertsService: PublicAlertsService,
    private readonly webPushService: WebPushService,
    private readonly areaResolver: PublicAreaResolver,
    private readonly publicWeatherService: PublicWeatherService,
    private readonly publicLocateService: PublicLocateService,
    private readonly airQualityService: AirQualityService,
  ) {}

  // GPS → kabupaten/kota (+ kecamatan/desa when OSM names match) for the
  // portal's automatic location. Coordinates are used for the lookup only
  // and never stored.
  @Get('locate')
  locate(@Query() query: LocateQueryDto) {
    return this.publicLocateService.locate(query.lat, query.lng);
  }

  // null (not 404) when the district has no reference point or Open-Meteo
  // is unreachable — the portal just hides the wind card.
  @Get('weather')
  getWeather(@Query('district', ParseUUIDPipe) district: string) {
    return this.publicWeatherService.getForDistrict(district);
  }

  // Wind at fire locations for the smoke-drift map. Same result order as
  // the requested points; a point whose lookup failed is null.
  @Get('wind')
  getWind(@Query() query: WindQueryDto) {
    const points = query.points.split(';').map((pair) => {
      const [latitude, longitude] = pair.split(',').map(Number);
      return { latitude, longitude };
    });
    if (points.length > MAX_WIND_POINTS) {
      throw new BadRequestException(
        `At most ${MAX_WIND_POINTS} points per request`,
      );
    }
    if (
      points.some(
        (p) => Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180,
      )
    ) {
      throw new BadRequestException('Coordinates out of range');
    }
    return this.publicWeatherService.getWindAt(points);
  }

  // Modelled air quality (PM2.5/PM10/CO/CO2 + ISPU category) at the
  // citizen's area and at fires. Same "lat,lng;lat,lng" points as /wind.
  @Get('air-quality')
  getAirQuality(@Query() query: WindQueryDto) {
    const points = query.points.split(';').map((pair) => {
      const [latitude, longitude] = pair.split(',').map(Number);
      return { latitude, longitude };
    });
    if (points.length > MAX_AIR_QUALITY_POINTS) {
      throw new BadRequestException(
        `At most ${MAX_AIR_QUALITY_POINTS} points per request`,
      );
    }
    if (
      points.some(
        (p) => Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180,
      )
    ) {
      throw new BadRequestException('Coordinates out of range');
    }
    return this.airQualityService.getAt(points);
  }

  // Nearest OpenAQ station reading (measured, not modelled) for the citizen
  // home page; null when none reported nearby in the last 3 h.
  @Get('air-quality/station')
  getAirQualityStation(@Query() query: LocateQueryDto) {
    return this.airQualityService.nearestStation({
      latitude: query.lat,
      longitude: query.lng,
    });
  }

  @Get('push/public-key')
  getPushPublicKey() {
    return { publicKey: this.webPushService.getPublicKey() };
  }

  @Post('push/subscriptions')
  @HttpCode(204)
  async subscribe(
    @Body() dto: CreatePushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    const area = await this.areaResolver.resolve(
      dto.districtId,
      dto.subdistrictId,
      dto.villageId,
    );
    await this.webPushService.upsertSubscription({
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      area,
      userAgent: userAgent ?? null,
    });
  }

  @Delete('push/subscriptions')
  @HttpCode(204)
  async unsubscribe(@Body() dto: RemovePushSubscriptionDto) {
    await this.webPushService.removeSubscription(dto.endpoint);
  }

  @Get('alerts/active')
  findActive(@Query() query: AreaQueryDto) {
    return this.publicAlertsService.findActiveForArea(query);
  }

  @Get('alerts/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicAlertsService.findOneView(id);
  }

  @Post('alerts/:id/responses')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAlertResponseDto,
  ) {
    return this.publicAlertsService.respond(id, dto);
  }
}
