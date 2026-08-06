import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateResourceOptimizationPlanDto {
  @IsUUID()
  districtId: string;

  @IsOptional()
  @IsUUID()
  hazardEventId?: string;

  @IsOptional()
  @IsUUID()
  riskAssessmentId?: string;

  // 'evacuation' | 'shelter_allocation' | 'logistics'
  @IsString()
  planType: string;

  @IsObject()
  planDetails: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedPersonnelNeeded?: number;
}
