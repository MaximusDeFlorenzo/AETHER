import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { RoleName } from '../../common/enums/roles.enum';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  fullName: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(RoleName)
  role: RoleName;
}
