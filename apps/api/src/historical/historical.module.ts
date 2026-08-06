import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistoricalDisaster } from '../database/entities';
import { HistoricalService } from './historical.service';
import { HistoricalController } from './historical.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([HistoricalDisaster]), AuditModule],
  controllers: [HistoricalController],
  providers: [HistoricalService],
  exports: [HistoricalService],
})
export class HistoricalModule {}
