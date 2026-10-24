import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  District,
  HazardEvent,
  KarhutlaPredictionRun,
} from '../database/entities';
import { HotspotMapService } from './hotspot-map.service';
import { PublicFireController } from './public-fire.controller';
import { SmokeMapService } from './smoke-map.service';

/** Citizen portal fire map: FIRMS hotspot clusters/points and the latest
 * karhutla smoke forecast. */
@Module({
  imports: [
    TypeOrmModule.forFeature([HazardEvent, District, KarhutlaPredictionRun]),
  ],
  controllers: [PublicFireController],
  providers: [HotspotMapService, SmokeMapService],
})
export class PublicFireModule {}
