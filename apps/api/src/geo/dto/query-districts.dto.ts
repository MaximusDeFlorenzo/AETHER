import { IsOptional, IsUUID } from 'class-validator';

export class QueryDistrictsDto {
  @IsOptional()
  @IsUUID()
  province?: string;
}
