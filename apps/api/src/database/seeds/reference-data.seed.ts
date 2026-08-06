/**
 * Reference data seed: BPS-style administrative/population data and BNPB-
 * style historical earthquake records — same order-of-magnitude-accurate
 * (not live) approach ORION used, since BNPB/BPS don't have a guaranteed
 * stable live public API. The geo/historical modules also expose CRUD so
 * real operators can maintain it going forward. Without this seed,
 * hazard-event ingestion has no districts to resolve affected regions
 * against, so this is functionally required, not just illustrative.
 */
import { DataSource } from 'typeorm';
import {
  District,
  HistoricalDisaster,
  PopulationStatistic,
  Province,
} from '../entities';
import { HazardType } from '../../common/enums/domain.enum';

interface ProvinceSeed {
  bpsCode: string;
  name: string;
  districts: DistrictSeed[];
}

interface DistrictSeed {
  bpsCode: string;
  name: string;
  latitude: number;
  longitude: number;
  areaKm2: number;
  population: number;
  year: number;
}

const PROVINCES: ProvinceSeed[] = [
  {
    bpsCode: '34',
    name: 'D.I. Yogyakarta',
    districts: [
      {
        bpsCode: '3402',
        name: 'Kabupaten Bantul',
        latitude: -7.8747,
        longitude: 110.3262,
        areaKm2: 506.85,
        population: 1024000,
        year: 2025,
      },
      {
        bpsCode: '3404',
        name: 'Kabupaten Sleman',
        latitude: -7.7326,
        longitude: 110.3752,
        areaKm2: 574.82,
        population: 1125000,
        year: 2025,
      },
      {
        bpsCode: '3471',
        name: 'Kota Yogyakarta',
        latitude: -7.7956,
        longitude: 110.3695,
        areaKm2: 32.5,
        population: 373589,
        year: 2025,
      },
    ],
  },
  {
    bpsCode: '33',
    name: 'Jawa Tengah',
    districts: [
      {
        bpsCode: '3301',
        name: 'Kabupaten Cilacap',
        latitude: -7.7271,
        longitude: 109.0022,
        areaKm2: 2124.4,
        population: 1973000,
        year: 2025,
      },
      {
        bpsCode: '3305',
        name: 'Kabupaten Kebumen',
        latitude: -7.6708,
        longitude: 109.6531,
        areaKm2: 1281.2,
        population: 1181000,
        year: 2025,
      },
    ],
  },
  {
    bpsCode: '13',
    name: 'Sumatera Barat',
    districts: [
      {
        bpsCode: '1371',
        name: 'Kota Padang',
        latitude: -0.9471,
        longitude: 100.4172,
        areaKm2: 694.9,
        population: 939000,
        year: 2025,
      },
      {
        bpsCode: '1302',
        name: 'Kabupaten Pesisir Selatan',
        latitude: -1.4879,
        longitude: 100.9686,
        areaKm2: 5749.9,
        population: 485000,
        year: 2025,
      },
    ],
  },
  {
    bpsCode: '52',
    name: 'Nusa Tenggara Barat',
    districts: [
      {
        bpsCode: '5201',
        name: 'Kabupaten Lombok Barat',
        latitude: -8.6142,
        longitude: 116.106,
        areaKm2: 1053.9,
        population: 698000,
        year: 2025,
      },
      {
        bpsCode: '5203',
        name: 'Kabupaten Lombok Timur',
        latitude: -8.6234,
        longitude: 116.5401,
        areaKm2: 1605.5,
        population: 1325000,
        year: 2025,
      },
    ],
  },
  {
    bpsCode: '72',
    name: 'Sulawesi Tengah',
    districts: [
      {
        bpsCode: '7271',
        name: 'Kota Palu',
        latitude: -0.8917,
        longitude: 119.8707,
        areaKm2: 395.06,
        population: 373000,
        year: 2025,
      },
      {
        bpsCode: '7203',
        name: 'Kabupaten Sigi',
        latitude: -1.2833,
        longitude: 119.8333,
        areaKm2: 5196.0,
        population: 232000,
        year: 2025,
      },
    ],
  },
];

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
    districtBpsCode: '3402',
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
    districtBpsCode: '1371',
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
    districtBpsCode: '5203',
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
    districtBpsCode: '7271',
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
    districtBpsCode: '3305',
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

  const provinceByBpsCode = new Map<string, Province>();
  const districtByBpsCode = new Map<string, District>();

  for (const provinceSeed of PROVINCES) {
    let province = await provinceRepo.findOne({
      where: { bpsCode: provinceSeed.bpsCode },
    });
    if (!province) {
      province = await provinceRepo.save(
        provinceRepo.create({
          bpsCode: provinceSeed.bpsCode,
          name: provinceSeed.name,
        }),
      );
      console.log(`Seeded province ${province.name}`);
    }
    provinceByBpsCode.set(provinceSeed.bpsCode, province);

    for (const districtSeed of provinceSeed.districts) {
      let district = await districtRepo.findOne({
        where: { bpsCode: districtSeed.bpsCode },
      });
      if (!district) {
        district = districtRepo.create({
          bpsCode: districtSeed.bpsCode,
          name: districtSeed.name,
          province,
          areaKm2: districtSeed.areaKm2,
          geom: {
            type: 'Point',
            coordinates: [districtSeed.longitude, districtSeed.latitude],
          } as unknown as object,
        });
        district = await districtRepo.save(district);
        console.log(`Seeded district ${district.name}`);
      }
      districtByBpsCode.set(districtSeed.bpsCode, district);

      const existingStat = await populationRepo.findOne({
        where: { district: { id: district.id }, year: districtSeed.year },
      });
      if (!existingStat) {
        const density = districtSeed.population / districtSeed.areaKm2;
        await populationRepo.save(
          populationRepo.create({
            district,
            year: districtSeed.year,
            totalPopulation: districtSeed.population,
            populationDensity: Math.round(density * 100) / 100,
            source: 'BPS',
          }),
        );
        console.log(`Seeded population statistic for ${district.name}`);
      }
    }
  }

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
