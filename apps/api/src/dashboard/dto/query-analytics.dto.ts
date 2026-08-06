import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class QueryAnalyticsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  province?: string;
}
