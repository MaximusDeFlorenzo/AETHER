import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CvDetection, HazardEvent } from '../database/entities';
import { FieldReportsController } from './field-reports.controller';
import { FieldReportsService } from './field-reports.service';
import { RiskEngineOrchestrationModule } from '../risk-engine-orchestration/risk-engine-orchestration.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CvDetection, HazardEvent]),
    // Reuses CvEngineClient rather than duplicating the internal-token HTTP
    // client pattern (StorageService is @Global() and doesn't need importing).
    RiskEngineOrchestrationModule,
    AuditModule,
  ],
  controllers: [FieldReportsController],
  providers: [FieldReportsService],
})
export class FieldReportsModule {}
