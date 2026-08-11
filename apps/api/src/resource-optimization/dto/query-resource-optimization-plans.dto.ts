import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { HazardType } from '../../common/enums/domain.enum';

export class QueryResourceOptimizationPlansDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  district?: string;

  @IsOptional()
  @IsEnum(HazardType)
  hazardType?: HazardType;
}
