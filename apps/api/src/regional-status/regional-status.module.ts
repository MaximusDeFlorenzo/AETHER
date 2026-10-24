import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { District, RegionalEmergencyStatus } from '../database/entities';
import { AuditModule } from '../audit/audit.module';
import { RegionalStatusService } from './regional-status.service';
import {
  PublicRegionalStatusController,
  RegionalStatusController,
} from './regional-status.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RegionalEmergencyStatus, District]),
    AuditModule,
  ],
  controllers: [RegionalStatusController, PublicRegionalStatusController],
  providers: [RegionalStatusService],
})
export class RegionalStatusModule {}
