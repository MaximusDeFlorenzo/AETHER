import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { HazardType } from '../../common/enums/domain.enum';

export class QueryRiskAssessmentsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(HazardType)
  hazardType?: HazardType;

  @IsOptional()
  @IsUUID()
  district?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minRiskScore?: number;

  // Filters to hazardEventId IS NULL standing/baseline assessments.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  baseline?: boolean;
}
