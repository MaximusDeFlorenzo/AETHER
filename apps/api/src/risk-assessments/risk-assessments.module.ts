import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskAssessment } from '../database/entities';
import { RiskAssessmentsService } from './risk-assessments.service';
import { RiskAssessmentsController } from './risk-assessments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RiskAssessment])],
  controllers: [RiskAssessmentsController],
  providers: [RiskAssessmentsService],
  exports: [RiskAssessmentsService],
})
export class RiskAssessmentsModule {}
