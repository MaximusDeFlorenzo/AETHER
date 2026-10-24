import { of, throwError } from 'rxjs';
import { DistrictTerrainService } from './district-terrain.service';

const NOW = new Date('2026-10-07T03:00:00Z');

function build(opts: {
  fresh?: string[];
  sampledLastDay?: number;
  perDay?: number;
  get?: jest.Mock;
}) {
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue([
    { id: 'a', latitude: '-7.2', longitude: '109.9' },
    { id: 'b', latitude: '-6.2', longitude: '106.8' },
    { id: 'c', latitude: '-8.6', longitude: '116.1' },
  ]);
  const insertQb: Record<string, jest.Mock> = {};
  for (const m of ['insert', 'into', 'values', 'orUpdate']) {
    insertQb[m] = jest.fn(() => insertQb);
  }
  insertQb.execute = jest.fn().mockResolvedValue({});
  const query = jest.fn((sql: string) =>
    Promise.resolve(
      sql.includes('count(*)')
        ? [{ n: String(opts.sampledLastDay ?? 0) }]
        : (opts.fresh ?? []).map((id) => ({ district_id: id })),
    ),
  );
  const get =
    opts.get ??
    jest.fn((_url: string, { params }: { params: { latitude: string } }) => {
      const n = params.latitude.split(',').length;
      // Rising northward: a constant N–S gradient on every site.
      return of({
        data: {
          elevation: Array.from({ length: n }, (_, i) =>
            i % 4 === 0 ? 120 : i % 4 === 1 ? 80 : 100,
          ),
        },
      });
    });
  const service = new DistrictTerrainService(
    { get } as never,
    {
      get: jest.fn((key: string) =>
        key === 'TERRAIN_SAMPLING_DISTRICTS_PER_DAY' ? opts.perDay : undefined,
      ),
    } as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    { query, createQueryBuilder: jest.fn(() => insertQb) } as never,
  );
  jest
    .spyOn(service as unknown as { pause: () => Promise<void> }, 'pause')
    .mockResolvedValue(undefined);
  return { service, get, insertQb };
}

describe('DistrictTerrainService', () => {
  it('samples due districts with one 64-coordinate request each', async () => {
    const { service, get, insertQb } = build({ fresh: ['c'] });
    const summary = await service.refresh(NOW);
    expect(summary).toEqual(
      expect.objectContaining({
        districtsDue: 2,
        districtsSampled: 2,
        districtsFailed: 0,
        districtsDeferred: 0,
        rateLimited: false,
      }),
    );
    expect(get).toHaveBeenCalledTimes(2);
    // Paced between requests, not before the first.
    expect(
      (service as unknown as { pause: jest.Mock }).pause,
    ).toHaveBeenCalledTimes(1);
    const params = get.mock.calls[0][1].params;
    expect(params.latitude.split(',')).toHaveLength(64);
    const row = insertQb.values.mock.calls[0][0];
    expect(row).toEqual(
      expect.objectContaining({
        source: 'open-meteo-elevation',
        dem: 'Copernicus GLO-90',
        samplesPlanned: 16,
        samplesValid: 16,
        sampledAt: NOW,
      }),
    );
    // 40 m over ~185 m ≈ 12°.
    expect(row.slopeSamplesDeg[0]).toBeGreaterThan(11);
    expect(row.slopeSamplesDeg[0]).toBeLessThan(13);
  });

  it('respects the rolling 24 h budget', async () => {
    const { service, get } = build({ perDay: 3, sampledLastDay: 2 });
    const summary = await service.refresh(NOW);
    expect(get).toHaveBeenCalledTimes(1);
    expect(summary).toEqual(
      expect.objectContaining({
        districtsDue: 3,
        districtsSampled: 1,
        districtsDeferred: 2,
      }),
    );
  });

  it('stops on HTTP 429 and skips failed requests', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('timeout')))
      .mockReturnValueOnce(throwError(() => ({ response: { status: 429 } })));
    const { service, insertQb } = build({ get });
    const summary = await service.refresh(NOW);
    expect(get).toHaveBeenCalledTimes(2);
    expect(summary).toEqual(
      expect.objectContaining({
        districtsSampled: 0,
        districtsFailed: 1,
        rateLimited: true,
      }),
    );
    expect(insertQb.execute).not.toHaveBeenCalled();
  });

  it('refuses a short elevation answer', async () => {
    const get = jest.fn(() => of({ data: { elevation: [1, 2, 3] } }));
    const { service } = build({ get });
    const summary = await service.refresh(NOW);
    expect(summary?.districtsFailed).toBe(3);
  });
});
