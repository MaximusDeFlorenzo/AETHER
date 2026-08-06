import { PartialType } from '@nestjs/swagger';
import { CreateHistoricalDisasterDto } from './create-historical-disaster.dto';

export class UpdateHistoricalDisasterDto extends PartialType(
  CreateHistoricalDisasterDto,
) {}
