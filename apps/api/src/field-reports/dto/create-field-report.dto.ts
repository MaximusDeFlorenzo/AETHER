import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { HazardType } from '../../common/enums/domain.enum';

// Everything except the image file itself (handled separately via
// @UploadedFile()) — multipart/form-data fields arrive as strings, hence
// @Type(() => Number) on the coordinates, same pattern manual-hazard-
// event.dto.ts uses for its (JSON-body, but still string-ish) lat/lon.
export class CreateFieldReportDto {
  // Narrows which of the four CV detectors run (see field-reports.service.ts
  // CATEGORIES_BY_HAZARD_HINT) — a hint, not a claim; the CV engine still
  // decides what it actually sees.
  @IsOptional()
  @IsEnum(HazardType)
  hazardTypeHint?: HazardType;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
