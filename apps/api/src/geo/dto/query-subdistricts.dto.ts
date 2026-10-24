import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QuerySubdistrictsDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
