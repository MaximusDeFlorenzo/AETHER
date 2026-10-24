import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  GroundObservationType,
  GroundReportStatus,
} from '../ground-report.enums';

export class QueryGroundReportsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(GroundReportStatus)
  status?: GroundReportStatus;

  @IsOptional()
  @IsEnum(GroundObservationType)
  observationType?: GroundObservationType;
}
