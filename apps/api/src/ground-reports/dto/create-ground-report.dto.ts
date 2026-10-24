import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  GroundObservationType,
  GroundReportSeverity,
} from '../ground-report.enums';

// Multipart fields (photos arrive separately as `images`) — everything is a
// string on the wire, hence @Type(() => Number). Range checks that depend on
// "now" or on other fields (Indonesia bounds, observedAt window, depth only
// for floodwater) live in lib/report-rules.ts and the service.
export class CreateGroundReportDto {
  @IsEnum(GroundObservationType)
  observationType: GroundObservationType;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  // A zone offset is required: a bare local time is ambiguous across
  // WIB/WITA/WIT.
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(Z|[+-]\d{2}:?\d{2})$/, {
    message: 'observedAt must include a time zone offset (e.g. +07:00 or Z)',
  })
  observedAt: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  waterDepthCm?: number;

  @IsOptional()
  @IsEnum(GroundReportSeverity)
  reporterSeverity?: GroundReportSeverity;
}
