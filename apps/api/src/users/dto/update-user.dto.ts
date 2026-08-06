import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { RoleName } from '../../common/enums/roles.enum';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
