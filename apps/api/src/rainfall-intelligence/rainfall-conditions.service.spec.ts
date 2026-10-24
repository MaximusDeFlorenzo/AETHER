import { NotFoundException } from '@nestjs/common';
import type { HourlyValues } from './lib/features';
import { RainfallConditionsService } from './rainfall-conditions.service';

const HOUR_MS = 3_600_000;
const LATEST = new Date('2026-10-06T12:00:00Z');
const DISTRICT = { id: 'd1', name: 'Kota Bogor', bpsCode: '32.71' };

function hours(count: number, districtId = 'd1') {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    district: { id: districtId },
    validTime: new Date(LATEST.getTime() - (count - 1 - i) * HOUR_MS),
    precipitationMm: 2,
    windSpeed10mKmh: 10,
    windFrom10mDeg: 270,
    windSpeed850hPaKmh: 15,
    windFrom850hPaDeg: 250,
    windSpeed700hPaKmh: 20,
    windFrom700hPaDeg: 240,
    temperatureC: 27,
    relativeHumidityPct: 85,
    surfacePressureHpa: 1009,
    soilMoisture9To27cmM3m3: 0.32,
    qualityFlags: [],
  })) as Array<HourlyValues & { district: { id: string } }>;
}

function build(
  samples: unknown[],
  lastSync: Date | null = LATEST,
  satellite: unknown[] = [],
) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'leftJoin',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  // Model samples are queried first, satellite samples second.
  qb.getMany = jest
    .fn()
    .mockResolvedValueOnce(samples)
    .mockResolvedValueOnce(satellite);
  const districtRepository = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === 'd1' ? DISTRICT : null),
    ),
    find: jest
      .fn()
      .mockResolvedValue([
        DISTRICT,
        { id: 'd2', name: 'Kab. Tanpa Data', bpsCode: '99.01' },
      ]),
  };
  const sampleRepository = { createQueryBuilder: jest.fn(() => qb) };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const sync = { getLastSyncedAt: jest.fn().mockResolvedValue(lastSync) };
  return new RainfallConditionsService(
    config as never,
    districtRepository as never,
    sampleRepository as never,
    sync as never,
  );
}

/** GSMaP rows: only precipitation is set. */
function satelliteHours(
  count: number,
  source: 'gsmap_now' | 'gsmap_gauge_now',
  mm: number,
) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${source}${i}`,
    source,
    district: { id: 'd1' },
    validTime: new Date(LATEST.getTime() - (count - 1 - i) * HOUR_MS),
    precipitationMm: i === 0 ? null : mm,
    qualityFlags: i === 0 ? ['gsmap:no_observation'] : [],
  }));
}

describe('RainfallConditionsService.getConditions', () => {
  it('returns features, provenance and freshness from stored history', async () => {
    const service = build(hours(30));
    const result = await service.getConditions(
      'd1',
      new Date(LATEST.getTime() + 20 * 60_000),
    );

    expect(result.status).toBe('ok');
    expect(result.provenance.dataKind).toBe('nwp_model');
    expect(result.dataQuality).toEqual(
      expect.objectContaining({
        dataAgeMinutes: 20,
        freshness: 'fresh',
        missingHours24h: [],
        issues: [],
      }),
    );
    expect(
      result.features?.accumulations.find((a) => a.windowHours === 24),
    ).toEqual(expect.objectContaining({ totalMm: 48, complete: true }));
    expect(result.hourly24h).toHaveLength(24);
  });

  it('marks old data stale and says why', async () => {
    const service = build(hours(30));
    const result = await service.getConditions(
      'd1',
      new Date(LATEST.getTime() + 10 * HOUR_MS),
    );
    expect(result.status).toBe('stale');
    expect(result.dataQuality.freshness).toBe('stale');
    expect(result.dataQuality.issues[0]).toMatch(/600 min old \(stale\)/);
  });

  it('reports no_data instead of inventing values', async () => {
    const service = build([], null);
    const result = await service.getConditions('d1', LATEST);
    expect(result.status).toBe('no_data');
    expect(result.features).toBeNull();
    expect(result.dataQuality.issues).toEqual([
      'Rainfall ingestion has never run successfully.',
    ]);
  });

  it('reports satellite rainfall per product, separately from the model', async () => {
    const service = build(hours(30), LATEST, [
      ...satelliteHours(24, 'gsmap_now', 1),
      ...satelliteHours(24, 'gsmap_gauge_now', 2),
    ]);
    const result = await service.getConditions(
      'd1',
      new Date(LATEST.getTime() + 20 * 60_000),
    );

    expect(result.satellite.provenance.dataKind).toBe('satellite_estimate');
    const gauge = result.satellite.products.find(
      (p) => p.source === 'gsmap_gauge_now',
    );
    expect(gauge).toEqual(
      expect.objectContaining({
        status: 'ok',
        freshness: 'fresh',
        latestHourMm: 2,
        flags24h: { 'gsmap:no_observation': 1 },
      }),
    );
    // 3 h complete; 24 h has one GSMaP-missing hour → no total, only a
    // lower bound.
    expect(gauge?.accumulations.find((a) => a.windowHours === 3)).toEqual(
      expect.objectContaining({ totalMm: 6, complete: true }),
    );
    expect(gauge?.accumulations.find((a) => a.windowHours === 24)).toEqual(
      expect.objectContaining({
        totalMm: null,
        availableMm: 46,
        hoursAvailable: 23,
        complete: false,
      }),
    );
    // The model's own features are untouched by satellite rows.
    expect(
      result.features?.accumulations.find((a) => a.windowHours === 24)?.totalMm,
    ).toBe(48);
  });

  it('reports satellite no_data when GSMaP has not been ingested', async () => {
    const service = build(hours(30));
    const result = await service.getConditions('d1', LATEST);
    expect(result.satellite.products.map((p) => p.status)).toEqual([
      'no_data',
      'no_data',
    ]);
  });

  it('404s for an unknown district', async () => {
    const service = build([]);
    await expect(service.getConditions('nope', LATEST)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('RainfallConditionsService.listConditions', () => {
  it('summarizes every district, including those without data', async () => {
    const service = build(hours(24));
    const list = await service.listConditions(
      new Date(LATEST.getTime() + 30 * 60_000),
    );

    expect(list).toHaveLength(2);
    expect(list[0]).toEqual(
      expect.objectContaining({
        status: 'ok',
        latestHourMm: 2,
        wind10m: { speedKmh: 10, fromDeg: 270, compassFrom: 'W' },
      }),
    );
    expect(list[0].accumulations.map((a) => a.windowHours)).toEqual([
      1, 3, 6, 24,
    ]);
    expect(list[1]).toEqual(
      expect.objectContaining({
        status: 'no_data',
        latestValidTime: null,
        satellite: null,
      }),
    );
  });
});
