import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResourceOptimizationPlan, Shelter } from '../database/entities';
import { ResourceOptimizationService } from './resource-optimization.service';
import { ResourceOptimizationController } from './resource-optimization.controller';
import { RiskEngineOrchestrationModule } from '../risk-engine-orchestration/risk-engine-orchestration.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([ResourceOptimizationPlan, Shelter]),
    RiskEngineOrchestrationModule,
  ],
  controllers: [ResourceOptimizationController],
  providers: [ResourceOptimizationService],
  exports: [ResourceOptimizationService],
})
export class ResourceOptimizationModule {}
