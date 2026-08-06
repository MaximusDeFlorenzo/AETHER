import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CvDetectionType } from '../../common/enums/domain.enum';

export class QueryFieldReportsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(CvDetectionType)
  detectionType?: CvDetectionType;
}
