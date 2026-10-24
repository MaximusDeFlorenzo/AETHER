import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { GroundReportStatus } from '../ground-report.enums';

export class TransitionGroundReportDto {
  @IsEnum(GroundReportStatus)
  to: GroundReportStatus;

  // Required for needs_more_evidence, corroborated, rejected, unverifiable
  // and reopening (lib/transitions.ts); shown to the reporter.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  // Internal reviewer notes — never shown to the reporter.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
