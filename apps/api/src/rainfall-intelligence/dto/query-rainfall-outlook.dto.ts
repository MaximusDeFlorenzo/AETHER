import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export const OUTLOOK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] as const;
export type OutlookSeverity = (typeof OUTLOOK_SEVERITIES)[number];

export class QueryRainfallOutlookDto {
  @ApiPropertyOptional({
    enum: OUTLOOK_SEVERITIES,
    description:
      'Only districts whose flood or landslide level is at least this (districts without any issued level are excluded when set).',
  })
  @IsOptional()
  @IsIn(OUTLOOK_SEVERITIES)
  minSeverity?: OutlookSeverity;

  @ApiPropertyOptional({
    description:
      'Map/list view: omit recommendations and confidence reasons (fetch /outlook/:districtId for them). Recommendation codes are kept.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  compact?: boolean;
}
