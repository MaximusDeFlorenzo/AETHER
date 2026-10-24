import { DistrictHazardIndexService } from './district-hazard-index.service';

const NOW = new Date('2026-10-07T03:00:00Z');

function build(
  freshIds: string[],
  value: (lon: number) => number | null | undefined,
) {
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue([
    { id: 'a', latitude: '-6.2', longitude: '106.8' },
    { id: 'b', latitude: '-7.0', longitude: '110.4' },
  ]);
  const insertQb: Record<string, jest.Mock> = {};
  for (const m of ['insert', 'into', 'values', 'orUpdate']) {
    insertQb[m] = jest.fn(() => insertQb);
  }
  insertQb.execute = jest.fn().mockResolvedValue({});
  const bnpb = {
    lookupIndexValue: jest.fn((_layer: string, lon: number) => {
      const v = value(lon);
      return Promise.resolve(
        v === undefined
          ? { value: null, failed: true }
          : { value: v, failed: false },
      );
    }),
  };
  const service = new DistrictHazardIndexService(
    bnpb as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    {
      query: jest
        .fn()
        .mockResolvedValue(freshIds.map((id) => ({ district_id: id }))),
      createQueryBuilder: jest.fn(() => insertQb),
    } as never,
  );
  return { service, bnpb, insertQb };
}

describe('DistrictHazardIndexService', () => {
  it('samples five points per due district and upserts a summary', async () => {
    const { service, bnpb, insertQb } = build([], (lon) =>
      lon > 110 ? null : 0.5,
    );
    const summary = await service.refresh('INDEKS_BAHAYA_BANJIR', NOW);

    expect(bnpb.lookupIndexValue).toHaveBeenCalledTimes(10);
    expect(summary).toEqual(
      expect.objectContaining({
        districtsSampled: 2,
        districtsSkipped: 0,
        districtsWithData: 1,
        districtsFailed: 0,
      }),
    );
    const rows = insertQb.values.mock.calls[0][0];
    expect(rows[0]).toEqual(
      expect.objectContaining({
        layer: 'INDEKS_BAHAYA_BANJIR',
        source: 'bnpb_inarisk',
        valueMean: 0.5,
        samplesValid: 5,
        sampledAt: NOW,
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({ valueMean: null, samplesValid: 0 }),
    );
  });

  it('stores NoData but leaves districts with a failed lookup for the next refresh', async () => {
    const { service, insertQb } = build([], (lon) =>
      lon > 110 ? undefined : null,
    );
    const summary = await service.refresh('INDEKS_BAHAYA_BANJIR', NOW);
    expect(summary).toEqual(
      expect.objectContaining({ districtsWithData: 0, districtsFailed: 1 }),
    );
    const rows = insertQb.values.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({ samplesValid: 0, valueMean: null }),
    );
  });

  it('skips districts sampled recently', async () => {
    const { service, bnpb, insertQb } = build(['a', 'b'], () => 0.5);
    const summary = await service.refresh('INDEKS_BAHAYA_BANJIR', NOW);
    expect(summary?.districtsSkipped).toBe(2);
    expect(bnpb.lookupIndexValue).not.toHaveBeenCalled();
    expect(insertQb.execute).not.toHaveBeenCalled();
  });
});
