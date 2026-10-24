import { NotFoundException } from '@nestjs/common';
import { GeoService } from './geo.service';

// A minimal fluent mock matching TypeORM's SelectQueryBuilder chain, so
// tests can assert which `andWhere` clauses a query actually attached
// (parent scoping, search) without a real database.
function createQueryBuilderMock(getManyAndCountResult: [unknown[], number]) {
  const qb: Record<string, jest.Mock> = {};
  const chain = ['leftJoinAndSelect', 'orderBy', 'skip', 'take', 'andWhere'];
  for (const method of chain) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue(getManyAndCountResult);
  return qb;
}

describe('GeoService.getLatestPopulation', () => {
  let populationStatisticRepository: { findOne: jest.Mock };
  let service: GeoService;

  beforeEach(() => {
    populationStatisticRepository = { findOne: jest.fn() };

    service = new GeoService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      populationStatisticRepository as any,
      {} as any,
      {} as any,
    );
  });

  it('selects the most recent year for a district with multiple population_statistics rows', async () => {
    // Doesn't assert TypeORM's ORDER BY actually sorts (that's the DB's
    // job) — asserts this service asks for the most recent year rather
    // than, say, the first inserted row or a hardcoded year.
    populationStatisticRepository.findOne.mockResolvedValue({
      id: 'stat-2024',
      year: 2024,
      totalPopulation: 239629,
      populationDensity: 57.41,
      regionCode: '11.01',
      source: 'Kemendagri (Ditjen Dukcapil) - Semester II Des 2024',
    });

    const result = await service.getLatestPopulation('district-1');

    expect(populationStatisticRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { district: { id: 'district-1' } },
        order: { year: 'DESC' },
      }),
    );
    expect(result.year).toBe(2024);
  });

  it('throws NotFoundException rather than returning a zero-filled stat when no row exists', async () => {
    populationStatisticRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getLatestPopulation('district-without-data'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('GeoService.getPopulationHistory', () => {
  let populationStatisticRepository: { find: jest.Mock };
  let service: GeoService;

  beforeEach(() => {
    populationStatisticRepository = { find: jest.fn().mockResolvedValue([]) };

    service = new GeoService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      populationStatisticRepository as any,
      {} as any,
      {} as any,
    );
  });

  it('orders history newest-year-first', async () => {
    await service.getPopulationHistory('district-1');

    expect(populationStatisticRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { district: { id: 'district-1' } },
        order: { year: 'DESC' },
      }),
    );
  });
});

describe('GeoService.findSubdistricts', () => {
  it('scopes the query to the given parent district, never returning the full table', async () => {
    const qb = createQueryBuilderMock([[{ id: 'sub-1' }], 1]);
    const subdistrictRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const service = new GeoService(
      {} as any,
      {} as any,
      subdistrictRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.findSubdistricts({
      district: 'district-1',
      page: 1,
      limit: 20,
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('district.id = :districtId', {
      districtId: 'district-1',
    });
    expect(result).toEqual({
      data: [{ id: 'sub-1' }],
      meta: { page: 1, limit: 20, total: 1 },
    });
  });

  it('applies a name search filter when provided', async () => {
    const qb = createQueryBuilderMock([[], 0]);
    const subdistrictRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const service = new GeoService(
      {} as any,
      {} as any,
      subdistrictRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.findSubdistricts({
      search: 'Bakongan',
      page: 1,
      limit: 20,
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('s.name ILIKE :search', {
      search: '%Bakongan%',
    });
  });

  it('does not filter by district when none is given (browsing all, still paginated)', async () => {
    const qb = createQueryBuilderMock([[], 0]);
    const subdistrictRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const service = new GeoService(
      {} as any,
      {} as any,
      subdistrictRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.findSubdistricts({ page: 1, limit: 20 } as any);

    expect(qb.take).toHaveBeenCalledWith(20);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });
});

describe('GeoService.findVillages', () => {
  it('scopes the query to the given parent subdistrict', async () => {
    const qb = createQueryBuilderMock([[{ id: 'village-1' }], 1]);
    const villageRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const service = new GeoService(
      {} as any,
      {} as any,
      {} as any,
      villageRepository as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.findVillages({
      subdistrict: 'subdistrict-1',
      page: 1,
      limit: 50,
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      'subdistrict.id = :subdistrictId',
      {
        subdistrictId: 'subdistrict-1',
      },
    );
    expect(result.meta.total).toBe(1);
  });
});

describe('GeoService.findSubdistrictOrThrow / findVillageOrThrow', () => {
  it('throws NotFoundException for a subdistrict id that does not exist', async () => {
    const subdistrictRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const service = new GeoService(
      {} as any,
      {} as any,
      subdistrictRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.findSubdistrictOrThrow('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException for a village id that does not exist', async () => {
    const villageRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new GeoService(
      {} as any,
      {} as any,
      {} as any,
      villageRepository as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.findVillageOrThrow('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('GeoService.getSubdistrictPopulationAggregate', () => {
  let subdistrictRepository: { findOne: jest.Mock };
  let villageRepository: { count: jest.Mock };
  let villagePopulationRepository: { query: jest.Mock };
  let service: GeoService;

  function buildService() {
    return new GeoService(
      {} as any,
      {} as any,
      subdistrictRepository as any,
      villageRepository as any,
      {} as any,
      villagePopulationRepository as any,
      {} as any,
    );
  }

  beforeEach(() => {
    subdistrictRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'sub-1', name: 'Bengkong' }),
    };
    villageRepository = { count: jest.fn() };
    villagePopulationRepository = { query: jest.fn() };
    service = buildService();
  });

  it('throws NotFoundException for a subdistrict id that does not exist', async () => {
    subdistrictRepository.findOne.mockResolvedValue(null);
    await expect(
      service.getSubdistrictPopulationAggregate('missing'),
    ).rejects.toThrow(NotFoundException);
  });

  it('reports zero coverage (not an error) when no village under the subdistrict has any imported population', async () => {
    villageRepository.count.mockResolvedValue(5);
    villagePopulationRepository.query.mockResolvedValue([]);

    const result = await service.getSubdistrictPopulationAggregate('sub-1');

    expect(result.totalVillages).toBe(5);
    expect(result.coveredVillages).toBe(0);
    expect(result.totalPopulation).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.coveragePercentage).toBe(0);
  });

  it('marks isComplete only when every village in the subdistrict is covered by the chosen group', async () => {
    villageRepository.count.mockResolvedValue(10);
    villagePopulationRepository.query.mockResolvedValue([
      {
        source_name: 'Binapemdes',
        period_status: 'unknown',
        period_year: null,
        covered_villages: '7',
        villages_with_total_population: '7',
        total_population: '15000',
        male: '7400',
        female: '7600',
        households: '3200',
      },
    ]);

    const result = await service.getSubdistrictPopulationAggregate('sub-1');

    expect(result.coveredVillages).toBe(7);
    expect(result.totalVillages).toBe(10);
    expect(result.isComplete).toBe(false); // 7 of 10 — partial, must never claim complete
    expect(result.coveragePercentage).toBe(70);
    expect(result.totalPopulation).toBe(15000);
    expect(result.sourceName).toBe('Binapemdes');
  });

  // The exact "never treat a blank value as zero" guard — SQL's SUM()
  // silently skips NULLs, so a naive implementation would show a sum from
  // fewer villages than `coveredVillages` claims without any signal.
  it('never reports totalPopulation as if it came from villages whose total_population was actually blank', async () => {
    villageRepository.count.mockResolvedValue(3);
    villagePopulationRepository.query.mockResolvedValue([
      {
        source_name: 'Binapemdes',
        period_status: 'unknown',
        period_year: null,
        covered_villages: '3', // 3 villages have A row...
        villages_with_total_population: '0', // ...but none has a usable total_population
        total_population: null,
        male: null,
        female: null,
        households: null,
      },
    ]);

    const result = await service.getSubdistrictPopulationAggregate('sub-1');

    expect(result.coveredVillages).toBe(3);
    expect(result.villagesWithTotalPopulation).toBe(0);
    expect(result.totalPopulation).toBeNull(); // not 0
  });

  it('picks the group with the most village coverage when multiple source/period combinations exist', async () => {
    villageRepository.count.mockResolvedValue(10);
    villagePopulationRepository.query.mockResolvedValue([
      {
        source_name: 'Binapemdes 2024',
        period_status: 'unknown',
        period_year: null,
        covered_villages: '9',
        villages_with_total_population: '9',
        total_population: '20000',
        male: '9800',
        female: '10200',
        households: '4000',
      },
      {
        source_name: 'Old Survey 2019',
        period_status: 'confirmed',
        period_year: 2019,
        covered_villages: '2',
        villages_with_total_population: '2',
        total_population: '3000',
        male: '1500',
        female: '1500',
        households: '700',
      },
    ]);

    const result = await service.getSubdistrictPopulationAggregate('sub-1');

    expect(result.sourceName).toBe('Binapemdes 2024');
    expect(result.coveredVillages).toBe(9);
    expect(result.otherGroupsAvailable).toBe(1);
  });
});
