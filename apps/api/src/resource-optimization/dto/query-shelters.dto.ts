import { IsOptional, IsUUID } from 'class-validator';

export class QuerySheltersDto {
  @IsOptional()
  @IsUUID()
  district?: string;
}
