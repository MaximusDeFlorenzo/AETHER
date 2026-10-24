import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import type { ShelterKind } from '../../database/entities/shelter.entity';
import { SHELTER_KINDS } from './create-shelter.dto';

export class QuerySheltersDto {
  @IsOptional()
  @IsUUID()
  district?: string;

  @IsOptional()
  @IsIn(SHELTER_KINDS)
  kind?: ShelterKind;

  /** Officer view: also list closed posko (the citizen portal never asks). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
