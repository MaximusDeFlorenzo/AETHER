import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryResourceOptimizationPlansDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  district?: string;
}
