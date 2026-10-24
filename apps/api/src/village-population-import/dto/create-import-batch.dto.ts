import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PopulationNumberFormat,
  PopulationPeriodStatus,
} from '../../common/enums/domain.enum';

// multipart/form-data fields alongside the `file` itself (handled via
// @UploadedFile()) — arrive as strings, same @Type(() => X) pattern
// create-field-report.dto.ts uses. `hasHeaderRow` deliberately does NOT use
// `@Type(() => Boolean)` — verified live that `Boolean('false')` is `true`
// in JS, so that decorator alone would silently treat "No" as "Yes" for
// every multipart submission. `@Transform` checks the literal string
// instead.
export class CreateImportBatchDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasHeaderRow: boolean;

  @IsEnum(PopulationNumberFormat)
  numberFormat: PopulationNumberFormat;

  @IsString()
  @MaxLength(200)
  sourceName: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceReference?: string;

  @IsEnum(PopulationPeriodStatus)
  periodStatus: PopulationPeriodStatus;

  // Required when periodStatus = 'confirmed', forbidden when 'unknown' —
  // never defaulted to the upload year (docs/DATABASE_SCHEMA.md §6c).
  @ValidateIf((dto) => dto.periodStatus === PopulationPeriodStatus.CONFIRMED)
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  periodYear?: number;
}
