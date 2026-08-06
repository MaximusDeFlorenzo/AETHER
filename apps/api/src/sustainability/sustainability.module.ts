import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  District,
  PopulationStatistic,
  ResourceOptimizationPlan,
  RiskAssessment,
  SustainabilityMetric,
} from '../database/entities';
import { SustainabilityService } from './sustainability.service';
import { SustainabilityController } from './sustainability.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SustainabilityMetric,
      District,
      RiskAssessment,
      ResourceOptimizationPlan,
      PopulationStatistic,
    ]),
  ],
  controllers: [SustainabilityController],
  providers: [SustainabilityService],
  exports: [SustainabilityService],
})
export class SustainabilityModule {}
