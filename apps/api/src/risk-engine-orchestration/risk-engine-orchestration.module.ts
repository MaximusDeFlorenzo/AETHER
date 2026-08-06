import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DecisionRecommendation,
  District,
  EarthquakeDetails,
  FloodDetails,
  HazardAffectedRegion,
  HazardEvent,
  LandslideDetails,
  RiskAssessment,
  WildfireDetails,
} from '../database/entities';
import { RiskEngineClient } from './risk-engine.client';
import { CvEngineClient } from './cv-engine.client';
import { RiskEngineOrchestrationService } from './risk-engine-orchestration.service';
import { GeoModule } from '../geo/geo.module';
import { HistoricalModule } from '../historical/historical.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([
      HazardEvent,
      HazardAffectedRegion,
      RiskAssessment,
      DecisionRecommendation,
      District,
      EarthquakeDetails,
      LandslideDetails,
      FloodDetails,
      WildfireDetails,
    ]),
    GeoModule,
    HistoricalModule,
  ],
  providers: [RiskEngineClient, CvEngineClient, RiskEngineOrchestrationService],
  exports: [RiskEngineClient, CvEngineClient, RiskEngineOrchestrationService],
})
export class RiskEngineOrchestrationModule {}
