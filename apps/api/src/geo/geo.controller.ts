import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GeoService } from './geo.service';
import { QueryDistrictsDto } from './dto/query-districts.dto';

@ApiTags('geo')
@Controller()
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('provinces')
  findProvinces() {
    return this.geoService.findAllProvinces();
  }

  @Get('districts')
  findDistricts(@Query() query: QueryDistrictsDto) {
    return this.geoService.findDistricts(query.province);
  }

  @Get('population/:districtId')
  getLatestPopulation(@Param('districtId', ParseUUIDPipe) districtId: string) {
    return this.geoService.getLatestPopulation(districtId);
  }

  @Get('population/:districtId/history')
  getPopulationHistory(@Param('districtId', ParseUUIDPipe) districtId: string) {
    return this.geoService.getPopulationHistory(districtId);
  }
}
