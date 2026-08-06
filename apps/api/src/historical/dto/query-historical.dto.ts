import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { HazardType } from '../../common/enums/domain.enum';

export class QueryHistoricalDto extends PaginationDto {
  @IsOptional()
  @IsEnum(HazardType)
  hazardType?: HazardType;

  @IsOptional()
  @IsUUID()
  province?: string;

  @IsOptional()
  @IsUUID()
  district?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minMagnitude?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
