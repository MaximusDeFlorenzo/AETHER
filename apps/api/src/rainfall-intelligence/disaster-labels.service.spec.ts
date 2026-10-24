import { DisasterLabelsService } from './disaster-labels.service';

describe('DisasterLabelsService', () => {
  it('imports each year, upserts labels and removes ones DIBI dropped', async () => {
    const dibi = {
      fetchYear: jest.fn(async (year: number) => [
        {
          id: `r${year}`,
          dt: Date.UTC(year, 1, 3, 15, 0),
          id_kab_sdi: '32.01',
          jenis_bencana: 'Banjir dan Tanah Longsor',
          meninggal: 0,
          hilang: 0,
          menderita_mengungsi: 4,
          rumah_terendam: 10,
          rumah_rusak_berat: 0,
          rumah_rusak_sedang: 0,
          rumah_rusak_ringan: 0,
        },
        {
          ...{ id: 'rob', dt: Date.UTC(year, 1, 3), id_kab_sdi: '32.01' },
          jenis_bencana: 'Banjir Rob',
        },
        {
          ...{ id: 'x', dt: Date.UTC(year, 1, 3), id_kab_sdi: '99.99' },
          jenis_bencana: 'Banjir',
        },
      ]),
    };
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: 'bogor', code: '32.01' }]),
    };
    const labels = {
      upsert: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([[], 2]),
    };
    const service = new DisasterLabelsService(
      dibi as never,
      { get: () => undefined } as never,
      { createQueryBuilder: () => qb } as never,
      labels as never,
    );
    const summary = await service.import(2024, 2025);
    expect(dibi.fetchYear.mock.calls.map((c) => c[0])).toEqual([2024, 2025]);
    expect(summary).toEqual({
      years: [2024, 2025],
      rowsFetched: 6,
      labelsUpserted: 4,
      labelsRemoved: 4,
      skipped: { not_rain_driven: 2, unknown_region: 2, bad_timestamp: 0 },
    });
    const [rows, conflict] = labels.upsert.mock.calls[0] as [
      Array<{ hazard: string; districtId: string; localTime: string }>,
      string[],
    ];
    expect(rows.map((r) => r.hazard)).toEqual(['flood', 'landslide']);
    expect(rows[0]).toEqual(
      expect.objectContaining({ districtId: 'bogor', localTime: '15:00:00' }),
    );
    expect(conflict).toEqual(['source', 'externalId', 'hazard']);
    expect(labels.query.mock.calls[0][1]).toEqual([
      'dibi',
      2024,
      ['r2024:flood', 'r2024:landslide'],
    ]);
  });
});
