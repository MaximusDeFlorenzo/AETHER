import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DecisionRecommendation,
  HazardEvent,
  HistoricalDisaster,
  Notification,
} from '../database/entities';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HazardEvent,
      DecisionRecommendation,
      Notification,
      HistoricalDisaster,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
