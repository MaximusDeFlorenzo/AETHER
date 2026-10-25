import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Phone keyboards often capitalise the first letter or leave a trailing
  // space; neither should make a correct address fail.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
