import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Province, District, PopulationStatistic } from '../database/entities';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Province, District, PopulationStatistic]),
  ],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
