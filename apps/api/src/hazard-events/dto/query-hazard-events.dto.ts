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

export class QueryHazardEventsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(HazardType)
  hazardType?: HazardType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minSeverity?: number;

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
