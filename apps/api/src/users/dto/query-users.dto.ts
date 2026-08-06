import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RoleName } from '../../common/enums/roles.enum';

export class QueryUsersDto extends PaginationDto {
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
