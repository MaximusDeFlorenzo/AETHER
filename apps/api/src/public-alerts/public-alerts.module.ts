import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  District,
  HazardEvent,
  PublicAlert,
  PublicAlertResponse,
  PushSubscription,
  Subdistrict,
  Village,
} from '../database/entities';
import { AuditModule } from '../audit/audit.module';
import { GeoModule } from '../geo/geo.module';
import { PublicAlertsService } from './public-alerts.service';
import { PublicAreaResolver } from './public-area.resolver';
import { WebPushService } from './web-push.service';
import { BmkgAutoAlertService } from './bmkg-auto-alert.service';
import { AirQualityService } from './air-quality.service';
import { PublicWeatherService } from './public-weather.service';
import { PublicLocateService } from './public-locate.service';
import { PublicAlertsController } from './public-alerts.controller';
import { PublicPortalController } from './public-portal.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PublicAlert,
      PublicAlertResponse,
      PushSubscription,
      District,
      HazardEvent,
      Subdistrict,
      Village,
    ]),
    AuditModule,
    GeoModule,
    HttpModule,
  ],
  controllers: [PublicAlertsController, PublicPortalController],
  providers: [
    PublicAlertsService,
    PublicAreaResolver,
    WebPushService,
    BmkgAutoAlertService,
    PublicWeatherService,
    AirQualityService,
    PublicLocateService,
  ],
})
export class PublicAlertsModule {}
