import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  District,
  HazardAffectedRegion,
  HazardEvent,
  HazardRelationship,
} from '../database/entities';
import { SpatialIntelligenceService } from './spatial-intelligence.service';
import { SpatialIntelligenceController } from './spatial-intelligence.controller';
import { GeoModule } from '../geo/geo.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HazardAffectedRegion,
      HazardRelationship,
      HazardEvent,
      District,
    ]),
    GeoModule,
  ],
  controllers: [SpatialIntelligenceController],
  providers: [SpatialIntelligenceService],
  exports: [SpatialIntelligenceService],
})
export class SpatialIntelligenceModule {}
