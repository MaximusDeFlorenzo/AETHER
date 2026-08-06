import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { HazardType, PriorityLevel } from '../../common/enums/domain.enum';

export class QueryDecisionRecommendationsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(PriorityLevel)
  priorityLevel?: PriorityLevel;

  @IsOptional()
  @IsEnum(HazardType)
  hazardType?: HazardType;
}
