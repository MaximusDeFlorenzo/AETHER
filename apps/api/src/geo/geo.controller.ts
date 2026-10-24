import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GeoService } from './geo.service';
import { QueryDistrictsDto } from './dto/query-districts.dto';
import { QuerySubdistrictsDto } from './dto/query-subdistricts.dto';
import { QueryVillagesDto } from './dto/query-villages.dto';

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

  @Get('districts/:id')
  findDistrict(@Param('id', ParseUUIDPipe) id: string) {
    return this.geoService.findDistrictOrThrow(id);
  }

  // Kecamatan — always scoped (?district=, ?search=) and paginated; the
  // full 7,285-row table is never returned in one response.
  @Get('subdistricts')
  findSubdistricts(@Query() query: QuerySubdistrictsDto) {
    return this.geoService.findSubdistricts(query);
  }

  @Get('subdistricts/:id')
  findSubdistrict(@Param('id', ParseUUIDPipe) id: string) {
    return this.geoService.findSubdistrictOrThrow(id);
  }

  // An AGGREGATION of village-level `village_populations` rows, never the
  // kecamatan's official population — see
  // GeoService.getSubdistrictPopulationAggregate's docstring. Returns a
  // zero-coverage result (not 404) when no village under this subdistrict
  // has any imported population yet.
  @Get('subdistricts/:id/population-aggregate')
  getSubdistrictPopulationAggregate(@Param('id', ParseUUIDPipe) id: string) {
    return this.geoService.getSubdistrictPopulationAggregate(id);
  }

  // Kelurahan/desa — always scoped (?subdistrict=, ?search=) and paginated;
  // the full 83,762-row table is never returned in one response.
  @Get('villages')
  findVillages(@Query() query: QueryVillagesDto) {
    return this.geoService.findVillages(query);
  }

  @Get('villages/:id')
  findVillage(@Param('id', ParseUUIDPipe) id: string) {
    return this.geoService.findVillageOrThrow(id);
  }

  // Empty array, not 404 — "nothing imported yet" is a normal state, per
  // GeoService.getVillagePopulations's docstring.
  @Get('villages/:id/population')
  getVillagePopulations(@Param('id', ParseUUIDPipe) id: string) {
    return this.geoService.getVillagePopulations(id);
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
