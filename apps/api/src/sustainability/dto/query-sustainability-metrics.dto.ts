import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class QuerySustainabilityMetricsDto {
  @IsOptional()
  @IsUUID()
  district?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}
