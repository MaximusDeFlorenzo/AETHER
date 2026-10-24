import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PublicAlertHazard } from '../../public-alerts/public-alert.enums';
import { EmergencyPhase } from '../emergency-phase.enum';

export class CreateRegionalStatusDto {
  @IsUUID()
  districtId: string;

  @IsEnum(EmergencyPhase)
  phase: EmergencyPhase;

  @IsEnum(PublicAlertHazard)
  hazard: PublicAlertHazard;

  @IsDateString({ strict: true })
  startsOn: string;

  @IsDateString({ strict: true })
  endsOn: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  decreeNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  sourceLabel: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

// Extending a status (the common case: "diperpanjang hingga …") or fixing
// its details. District and hazard stay fixed — a different area or hazard
// is a different declaration.
export class UpdateRegionalStatusDto {
  @IsOptional()
  @IsEnum(EmergencyPhase)
  phase?: EmergencyPhase;

  @IsOptional()
  @IsDateString({ strict: true })
  startsOn?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  decreeNumber?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  sourceLabel?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class QueryRegionalStatusesDto extends PaginationDto {}

export class PublicRegionalStatusQueryDto {
  @IsUUID()
  district: string;
}
