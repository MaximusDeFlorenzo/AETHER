import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PopulationImportRowResolutionAction } from '../../common/enums/domain.enum';

// `villageId` is conditionally required (only for REGION_NOT_FOUND /
// NEEDS_REVIEW, and only when action = ACCEPTED) — that depends on the
// ROW's current status, which this DTO can't see, so that check happens
// in VillagePopulationImportService.resolveRow instead of here.
export class ResolveImportRowDto {
  @IsEnum(PopulationImportRowResolutionAction)
  action: PopulationImportRowResolutionAction;

  @IsOptional()
  @IsUUID()
  villageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
