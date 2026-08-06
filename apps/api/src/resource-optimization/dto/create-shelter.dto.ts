import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsString, IsUUID, Min } from 'class-validator';

export class CreateShelterDto {
  @IsUUID()
  districtId: string;

  @IsString()
  name: string;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  capacity: number;
}
