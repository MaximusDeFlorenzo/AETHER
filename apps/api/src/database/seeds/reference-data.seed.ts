/**
 * Reference data seed: real BPS/Kemendagri administrative + population data
 * and BNPB-style historical earthquake/landslide records.
 *
 * `data/indonesia-districts.json` is all 514 of Indonesia's kabupaten/kota
 * (regencies/cities) — a real, sourced dataset, not illustrative: codes and
 * names from Kemendagri's official administrative code decree (Kepmendagri
 * No 300.2.2-2138 Tahun 2025), area from BIG (Badan Informasi Geospasial,
 * the national geospatial agency)'s official area calculation, population
 * from Kemendagri's population registry — all three merged from
 * github.com/cahyadsn/wilayah (MIT-licensed, actively maintained). Point
 * coordinates are from GeoNames' Indonesia ADM2 dump, name-matched against
 * the Kemendagri names (a handful of naming-variant/newly-split regencies
 * needed a manual real-coordinate fallback — see the merge script's
 * MANUAL_COORDS comments for per-district sourcing).
 *
 * Without this seed, hazard-event ingestion has no districts to resolve
 * affected regions against, so this is functionally required, not just
 * illustrative — previously only 11 hand-picked districts were seeded
 * (a historical-disaster demo set), which meant most real ingested events
 * (BMKG earthquakes anywhere outside Java/Sumatra/Lombok/Palu, NASA FIRMS
 * wildfire hotspots, PetaBencana Jakarta floods) resolved to zero affected
 * districts and never got scored. Full national coverage fixes that.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import {
  District,
  HistoricalDisaster,
  PopulationStatistic,
  Province,
  VulnerabilityIndicator,
} from '../entities';
import { HazardType } from '../../common/enums/domain.enum';

// Illustrative baseline vulnerability_indicators (docs/DATABASE_SCHEMA.md
// §19) so GET /spatial/overlay?layer=vulnerability returns real rows out of
// the box — unlike the district/population data above, no live per-district
// building-quality/healthcare-access/poverty-rate data source exists, so
// these stay a documented function of each district's own real population
// density (denser urban districts skew toward better healthcare access and
// construction stock, worse poverty rate) — real operators overwrite these
// via VulnerabilityIndicatorsService.upsert() (POST /vulnerability-indicators).
const VULNERABILITY_INDICATOR_YEAR = 2025;
const POPULATION_YEAR = 2025;

function clampIndex(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

interface DistrictRecord {
  districtCode: string;
  districtName: string;
  provinceCode: string;
  provinceName: string;
  latitude: number;
  longitude: number;
  areaKm2: number;
  population: number;
}

function loadDistricts(): DistrictRecord[] {
  const path = join(__dirname, 'data', 'indonesia-districts.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as DistrictRecord[];
}

const HISTORICAL_DISASTERS: Array<{
  hazardType: HazardType;
  provinceBpsCode: string;
  districtBpsCode: string | null;
  eventDate: string;
  magnitude: number | null;
  casualtiesDead: number;
  casualtiesInjured: number;
  casualtiesMissing: number;
  displacedPopulation: number;
  damagedBuildingsCount: number;
  damageDescription: string;
}> = [
  {
    hazardType: HazardType.EARTHQUAKE,
    provinceBpsCode: '34',
    districtBpsCode: '34.02',
    eventDate: '2006-05-27',
    magnitude: 6.3,
    casualtiesDead: 5782,
    casualtiesInjured: 36299,
    casualtiesMissing: 0,
    displacedPopulation: 600000,
    damagedBuildingsCount: 156662,
    damageDescription: '2006 Yogyakarta earthquake, epicenter near Bantul',
  },
  {
    hazardType: HazardType.EARTHQUAKE,
    provinceBpsCode: '13',
    districtBpsCode: '13.71',
    eventDate: '2009-09-30',
    magnitude: 7.6,
    casualtiesDead: 1115,
    casualtiesInjured: 1214,
    casualtiesMissing: 0,
    displacedPopulation: 250000,
    damagedBuildingsCount: 135299,
    damageDescription: '2009 Sumatra (Padang) earthquake',
  },
  {
    hazardType: HazardType.EARTHQUAKE,
    provinceBpsCode: '52',
    districtBpsCode: '52.03',
    eventDate: '2018-08-05',
    magnitude: 6.9,
    casualtiesDead: 564,
    casualtiesInjured: 1584,
    casualtiesMissing: 0,
    displacedPopulation: 445343,
    damagedBuildingsCount: 83392,
    damageDescription: '2018 Lombok earthquake sequence',
  },
  {
    hazardType: HazardType.EARTHQUAKE,
    provinceBpsCode: '72',
    districtBpsCode: '72.71',
    eventDate: '2018-09-28',
    magnitude: 7.4,
    casualtiesDead: 4340,
    casualtiesInjured: 10679,
    casualtiesMissing: 667,
    displacedPopulation: 206500,
    damagedBuildingsCount: 68451,
    damageDescription: 'Palu-Donggala earthquake and tsunami',
  },
  {
    hazardType: HazardType.LANDSLIDE,
    provinceBpsCode: '33',
    districtBpsCode: '33.05',
    eventDate: '2021-03-04',
    magnitude: null,
    casualtiesDead: 8,
    casualtiesInjured: 12,
    casualtiesMissing: 2,
    displacedPopulation: 350,
    damagedBuildingsCount: 40,
    damageDescription: 'Rainfall-triggered landslide, Kebumen highlands',
  },
];

export async function seedReferenceData(dataSource: DataSource): Promise<void> {
  const provinceRepo = dataSource.getRepository(Province);
  const districtRepo = dataSource.getRepository(District);
  const populationRepo = dataSource.getRepository(PopulationStatistic);
  const historicalRepo = dataSource.getRepository(HistoricalDisaster);
  const vulnerabilityRepo = dataSource.getRepository(VulnerabilityIndicator);

  const districts = loadDistricts();
  const provinceByBpsCode = new Map<string, Province>();
  const districtByBpsCode = new Map<string, District>();

  for (const record of districts) {
    let province = provinceByBpsCode.get(record.provinceCode);
    if (!province) {
      province =
        (await provinceRepo.findOne({
          where: { bpsCode: record.provinceCode },
        })) ?? undefined;
      if (!province) {
        province = await provinceRepo.save(
          provinceRepo.create({
            bpsCode: record.provinceCode,
            name: record.provinceName,
          }),
        );
        console.log(`Seeded province ${province.name}`);
      }
      provinceByBpsCode.set(record.provinceCode, province);
    }

    let district = await districtRepo.findOne({
      where: { bpsCode: record.districtCode },
    });
    if (!district) {
      district = districtRepo.create({
        bpsCode: record.districtCode,
        name: record.districtName,
        province,
        areaKm2: record.areaKm2,
        geom: {
          type: 'Point',
          coordinates: [record.longitude, record.latitude],
        } as unknown as object,
      });
      district = await districtRepo.save(district);
    }
    districtByBpsCode.set(record.districtCode, district);

    const density = record.population / record.areaKm2;

    const existingStat = await populationRepo.findOne({
      where: { district: { id: district.id }, year: POPULATION_YEAR },
    });
    if (!existingStat) {
      await populationRepo.save(
        populationRepo.create({
          district,
          year: POPULATION_YEAR,
          totalPopulation: record.population,
          populationDensity: Math.round(density * 100) / 100,
          source: 'Kemendagri',
        }),
      );
    }

    const indicatorSeeds: Array<{
      indicatorType: string;
      value: number;
      unit: string;
    }> = [
      {
        indicatorType: 'building_quality',
        value: clampIndex(80 - density / 100),
        unit: 'index',
      },
      {
        indicatorType: 'healthcare_access',
        value: clampIndex(50 + density / 50),
        unit: 'index',
      },
      {
        indicatorType: 'poverty_rate',
        value: clampIndex(20 - density / 200),
        unit: 'percent',
      },
    ];
    for (const indicatorSeed of indicatorSeeds) {
      const existingIndicator = await vulnerabilityRepo.findOne({
        where: {
          district: { id: district.id },
          indicatorType: indicatorSeed.indicatorType,
          year: VULNERABILITY_INDICATOR_YEAR,
        },
      });
      if (!existingIndicator) {
        await vulnerabilityRepo.save(
          vulnerabilityRepo.create({
            district,
            indicatorType: indicatorSeed.indicatorType,
            value: indicatorSeed.value,
            unit: indicatorSeed.unit,
            year: VULNERABILITY_INDICATOR_YEAR,
            source: 'illustrative_seed',
          }),
        );
      }
    }
  }
  console.log(
    `Seeded ${districts.length} districts across ${provinceByBpsCode.size} provinces`,
  );

  for (const record of HISTORICAL_DISASTERS) {
    const province = provinceByBpsCode.get(record.provinceBpsCode);
    const district = record.districtBpsCode
      ? districtByBpsCode.get(record.districtBpsCode)
      : null;
    if (!province) continue;

    const existing = await historicalRepo.findOne({
      where: {
        hazardType: record.hazardType,
        province: { id: province.id },
        eventDate: record.eventDate,
      },
    });
    if (!existing) {
      await historicalRepo.save(
        historicalRepo.create({
          hazardType: record.hazardType,
          province,
          district: district ?? null,
          eventDate: record.eventDate,
          magnitude: record.magnitude,
          casualtiesDead: record.casualtiesDead,
          casualtiesInjured: record.casualtiesInjured,
          casualtiesMissing: record.casualtiesMissing,
          displacedPopulation: record.displacedPopulation,
          damagedBuildingsCount: record.damagedBuildingsCount,
          damageDescription: record.damageDescription,
          source: record.hazardType === HazardType.EARTHQUAKE ? 'BNPB' : 'BNPB',
        }),
      );
      console.log(`Seeded historical disaster: ${record.damageDescription}`);
    }
  }
}
