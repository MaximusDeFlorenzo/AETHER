import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { HazardType } from '../../common/enums/domain.enum';

export class CreateHistoricalDisasterDto {
  @IsEnum(HazardType)
  hazardType: HazardType;

  @IsUUID()
  provinceId: string;

  @IsOptional()
  @IsUUID()
  districtId?: string;

  @IsDateString()
  eventDate: string;

  @IsOptional()
  @IsNumber()
  magnitude?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  casualtiesDead?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  casualtiesInjured?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  casualtiesMissing?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  displacedPopulation?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  damagedBuildingsCount?: number;

  @IsOptional()
  @IsString()
  damageDescription?: string;
}
