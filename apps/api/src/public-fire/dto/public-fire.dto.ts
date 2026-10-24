import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class HotspotMapQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  hours = 24;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit = 300;

  // Citizen location: clusters near it are returned whatever their rank.
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class HotspotPointsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  hours = 24;

  /** `west,south,east,north`, at most 10° on a side. */
  @IsString()
  @Matches(/^-?\d{1,3}(\.\d+)?(,-?\d{1,3}(\.\d+)?){3}$/, {
    message: 'bbox must be "west,south,east,north"',
  })
  bbox: string;
}

export class SmokeQueryDto {
  /** Hours from now the map shows; the run horizon valid closest to it is
   * returned. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  hours = 6;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}
