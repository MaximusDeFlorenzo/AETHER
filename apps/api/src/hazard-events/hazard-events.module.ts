import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  EarthquakeDetails,
  FloodDetails,
  HazardEvent,
  LandslideDetails,
  WildfireDetails,
} from '../database/entities';
import { HazardEventsService } from './hazard-events.service';
import { HazardEventsController } from './hazard-events.controller';
import { SpatialIntelligenceModule } from '../spatial-intelligence/spatial-intelligence.module';
import { GeoModule } from '../geo/geo.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HazardEvent,
      EarthquakeDetails,
      LandslideDetails,
      FloodDetails,
      WildfireDetails,
    ]),
    SpatialIntelligenceModule,
    GeoModule,
    // Circular: ingestion adapters call back into HazardEventsService.ingestEvent()
    // to persist what they fetch/normalize, while this controller triggers
    // ingestion's registry to run a manual sync.
    forwardRef(() => IngestionModule),
    AuditModule,
  ],
  controllers: [HazardEventsController],
  providers: [HazardEventsService],
  exports: [HazardEventsService],
})
export class HazardEventsModule {}
