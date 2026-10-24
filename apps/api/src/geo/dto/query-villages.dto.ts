import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryVillagesDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  subdistrict?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
