import { IsUUID } from 'class-validator';

export class LinkFieldReportDto {
  @IsUUID()
  hazardEventId: string;
}
