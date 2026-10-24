import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GroundReport,
  GroundReportEvidence,
  GroundReportStatusChange,
} from '../database/entities';
import { AuditModule } from '../audit/audit.module';
import { RiskEngineOrchestrationModule } from '../risk-engine-orchestration/risk-engine-orchestration.module';
import { GroundReportsController } from './ground-reports.controller';
import { GroundReportsService } from './ground-reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GroundReport,
      GroundReportEvidence,
      GroundReportStatusChange,
    ]),
    // CvEngineClient only (best-effort triage hint); StorageService is @Global().
    RiskEngineOrchestrationModule,
    AuditModule,
  ],
  controllers: [GroundReportsController],
  providers: [GroundReportsService],
})
export class GroundReportsModule {}
