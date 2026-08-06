import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DecisionRecommendation } from '../database/entities';
import { DecisionIntelligenceService } from './decision-intelligence.service';
import { DecisionIntelligenceController } from './decision-intelligence.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DecisionRecommendation])],
  controllers: [DecisionIntelligenceController],
  providers: [DecisionIntelligenceService],
  exports: [DecisionIntelligenceService],
})
export class DecisionIntelligenceModule {}
