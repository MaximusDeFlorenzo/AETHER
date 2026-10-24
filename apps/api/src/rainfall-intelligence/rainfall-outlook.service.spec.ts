import { NotFoundException } from '@nestjs/common';
import { RainfallOutlookService } from './rainfall-outlook.service';

const NOW = new Date('2026-10-07T06:20:00Z');
const VALID = new Date('2026-10-07T06:00:00Z');

const floodPoint = (id: string, level: string, factors: unknown[] = []) => ({
  id,
  status: 'ok',
  level,
  confidence: 'very_low',
  confidenceReasons: ['rainfall data is aging'],
  factors,
});
const landslidePoint = (id: string, level: string) => ({
  id,
  status: 'ok',
  level,
  confidence: 'very_low',
  confidenceReasons: [],
  terrainClass: 'high',
  factors: [],
});

function build(opts: { districts?: unknown[]; noRuns?: boolean } = {}) {
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['leftJoin', 'select', 'addSelect', 'orderBy', 'where']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue(
    opts.districts ?? [
      {
        id: 'a',
        name: 'Kab. A',
        provinceName: 'P',
        latitude: '-6',
        longitude: '106',
      },
      {
        id: 'b',
        name: 'Kota B',
        provinceName: 'P',
        latitude: '-7',
        longitude: '110',
      },
      {
        id: 'c',
        name: 'Kab. C',
        provinceName: 'P',
        latitude: '-8',
        longitude: '115',
      },
    ],
  );
  const nowcast = {
    id: 'n1',
    issuedAt: VALID,
    dataValidTime: VALID,
    modelVersions: { nowcast: 'v' },
    parameters: { calibrated: false },
    results: [
      {
        id: 'a',
        currentMmPerHour: 3,
        movement: {
          status: 'ok',
          towardDeg: 90,
          speedKmh: 20,
          confidence: 'low',
        },
        forecasts: [
          {
            method: 'persistence',
            horizonHours: 1,
            status: 'ok',
            probability: 0.3,
          },
          {
            method: 'motion_advection',
            horizonHours: 1,
            status: 'ok',
            probability: 0.7,
          },
        ],
      },
    ],
  };
  const risk = (hazard: string) =>
    hazard === 'flood'
      ? {
          id: 'f1',
          issuedAt: VALID,
          dataValidTime: VALID,
          modelVersion: 'flood-v',
          results: [
            floodPoint('a', 'MEDIUM', [
              {
                factor: 'rain_24h',
                value: 55.04,
                unit: 'mm',
                assessment: 'lebat',
                effect: 'raised',
              },
              {
                factor: 'rain_1h',
                value: 1,
                unit: 'mm',
                assessment: null,
                effect: 'not_scored',
              },
            ]),
            floodPoint('b', 'LOW'),
            floodPoint('c', 'LOW'),
          ],
        }
      : {
          id: 'l1',
          issuedAt: VALID,
          dataValidTime: VALID,
          modelVersion: 'landslide-v',
          results: [
            landslidePoint('a', 'LOW'),
            landslidePoint('b', 'MEDIUM'),
            landslidePoint('c', 'LOW'),
          ],
        };
  const service = new RainfallOutlookService(
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    {
      query: jest.fn().mockResolvedValue([
        {
          district_id: 'a',
          year: 2024,
          total_population: '100',
          population_density: '10',
          source: 'Dukcapil',
        },
        {
          district_id: 'b',
          year: 2024,
          total_population: '900',
          population_density: '90',
          source: 'Dukcapil',
        },
      ]),
    } as never,
    {
      findOne: jest.fn().mockResolvedValue(opts.noRuns ? null : nowcast),
    } as never,
    {
      findOne: jest.fn(({ where }: { where: { hazard: string } }) =>
        Promise.resolve(opts.noRuns ? null : risk(where.hazard)),
      ),
    } as never,
  );
  return { service, districtQb };
}

describe('RainfallOutlookService', () => {
  it('joins the latest runs per district, orders by severity then population', async () => {
    const { service } = build();
    const out = await service.outlook({}, NOW);

    expect(out.rulesVersion).toBe('rainfall-rules-v0.1');
    expect(out.sources.flood).toEqual(
      expect.objectContaining({ runId: 'f1', modelVersions: 'flood-v' }),
    );
    // a and b are both MEDIUM → b first (more people); c LOW last.
    expect(out.districts.map((d) => d.districtId)).toEqual(['b', 'a', 'c']);
    const a = out.districts[1];
    expect(a.severity).toBe('MEDIUM');
    expect(a.flood?.raisedBy).toEqual(['rain_24h 55 mm (lebat)']);
    expect(a.rain).toEqual(
      expect.objectContaining({
        nextHourProbability: 0.7,
        method: 'motion_advection',
        freshness: 'fresh',
        movement: expect.objectContaining({ towardDeg: 90 }),
      }),
    );
    expect(a.exposure).toEqual(
      expect.objectContaining({ population: 100, year: 2024 }),
    );
    expect(a.recommendationCodes).toEqual(
      expect.arrayContaining(['FLOOD_MONITOR', 'MORE_RAIN_INDICATED']),
    );
    // c: no nowcast point, no population.
    expect(out.districts[2].rain).toBeNull();
    expect(out.districts[2].exposure).toBeNull();
  });

  it('filters by minimum severity', async () => {
    const { service } = build();
    const out = await service.outlook({ minSeverity: 'MEDIUM' }, NOW);
    expect(out.districts.map((d) => d.districtId)).toEqual(['b', 'a']);
  });

  it('compact view keeps levels and codes but drops texts and reasons', async () => {
    const { service } = build();
    const full = await service.outlook({}, NOW);
    const compact = await service.outlook({ compact: true }, NOW);
    const a = compact.districts[1];
    expect(a.recommendations).toBeUndefined();
    expect(a.recommendationCodes).toEqual(
      full.districts[1].recommendationCodes,
    );
    expect(a.flood).not.toHaveProperty('confidenceReasons');
    expect(a.flood?.level).toBe('MEDIUM');
    expect(full.districts[1].recommendations?.[0].textId).toBeTruthy();
  });

  it('404s for an unknown district and reports missing runs', async () => {
    const { service } = build({ districts: [] });
    await expect(
      service.outlook(
        { districtId: '00000000-0000-4000-8000-000000000000' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const empty = build({ noRuns: true });
    const out = await empty.service.outlook({}, NOW);
    expect(out.missing).toHaveLength(3);
    expect(out.districts[0].severity).toBeNull();
    expect(out.districts[0].recommendationCodes).toEqual([
      'CHECK_OFFICIAL_WARNINGS',
      'OUTLOOK_UNAVAILABLE',
    ]);
  });
});
