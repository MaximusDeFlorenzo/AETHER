import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import type { ShelterKind } from '../../database/entities/shelter.entity';

export const SHELTER_KINDS: ShelterKind[] = ['posko', 'assembly_point'];

// Empty strings from the officer form mean "no value".
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreateShelterDto {
  @IsUUID()
  districtId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsIn(SHELTER_KINDS)
  kind?: ShelterKind;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentOccupancy?: number;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  contactPhone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
