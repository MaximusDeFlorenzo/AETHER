import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PopulationImportRowStatus } from '../../common/enums/domain.enum';

export class QueryImportRowsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(PopulationImportRowStatus)
  status?: PopulationImportRowStatus;
}
