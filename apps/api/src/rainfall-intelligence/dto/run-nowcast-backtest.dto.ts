import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_BACKTEST_HOURS } from '../rainfall-backtest.service';

export class RunNowcastBacktestDto {
  @ApiPropertyOptional({
    default: 24,
    description:
      'Hours of stored rain fields to evaluate (GSMaP_NOW keeps 24 h, so longer windows only help once history has accumulated).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(MAX_BACKTEST_HOURS)
  hours = 24;
}
