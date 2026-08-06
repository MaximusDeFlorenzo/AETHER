import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { HazardType } from '../../common/enums/domain.enum';

// Ground-truth reporting path (field_reporter role) — Phase 1's stand-in for
// hazard types with no live external ingestion adapter yet (landslide), and
// a manual-override path for earthquake. `details` shape is validated
// per-hazardType in HazardEventsService against the matching *_details
// schema (docs/DATABASE_SCHEMA.md §11-12) rather than here, since it varies
// by hazardType.
export class ManualHazardEventDto {
  @IsEnum(HazardType)
  hazardType: HazardType;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsString()
  locationLabel?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsDateString()
  eventTime: string;

  @IsObject()
  details: Record<string, unknown>;
}
