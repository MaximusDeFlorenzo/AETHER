import {
  dibiLocalDateTime,
  dibiQueryBody,
  dibiRowToLabels,
  hazardsForEventType,
  type DibiEventRow,
} from './dibi';

const row = (over: Partial<DibiEventRow> = {}): DibiEventRow => ({
  id: 'abc',
  // 2026-10-06 10:30 as published (wall-clock local time, serialised as UTC)
  dt: Date.UTC(2026, 9, 6, 10, 30),
  id_kab_sdi: '33.27',
  jenis_bencana: 'Tanah Longsor',
  meninggal: 2,
  hilang: null,
  menderita_mengungsi: 15,
  rumah_terendam: 0,
  rumah_rusak_berat: 1,
  rumah_rusak_sedang: 2,
  rumah_rusak_ringan: null,
  ...over,
});
const districts = new Map([['33.27', 'd-pemalang']]);

describe('DIBI labels', () => {
  it('maps rain-driven event types only; Banjir Rob (tidal) is excluded', () => {
    expect(hazardsForEventType('Banjir')).toEqual(['flood']);
    expect(hazardsForEventType('Banjir Bandang')).toEqual(['flood']);
    expect(hazardsForEventType('Gerakan Tanah')).toEqual(['landslide']);
    expect(hazardsForEventType('Banjir dan Tanah Longsor')).toEqual([
      'flood',
      'landslide',
    ]);
    expect(hazardsForEventType('Banjir Rob')).toEqual([]);
    expect(hazardsForEventType('Cuaca Ekstrem')).toEqual([]);
  });

  it('reads the published wall-clock date and time; 00:00 means date only', () => {
    expect(dibiLocalDateTime(Date.UTC(2026, 9, 6, 10, 30))).toEqual({
      localDate: '2026-10-06',
      localTime: '10:30:00',
    });
    expect(dibiLocalDateTime(Date.UTC(2025, 11, 31))).toEqual({
      localDate: '2025-12-31',
      localTime: null,
    });
    expect(dibiLocalDateTime(Number.NaN)).toBeNull();
  });

  it('turns one report into labels with summed house damage', () => {
    expect(dibiRowToLabels(row(), districts)).toEqual([
      expect.objectContaining({
        source: 'dibi',
        externalId: 'abc',
        hazard: 'landslide',
        districtId: 'd-pemalang',
        regionCode: '33.27',
        localDate: '2026-10-06',
        localTime: '10:30:00',
        dead: 2,
        missing: 0,
        affectedDisplaced: 15,
        housesDamaged: 3,
      }),
    ]);
    const both = dibiRowToLabels(
      row({ jenis_bencana: 'Banjir dan Tanah Longsor' }),
      districts,
    );
    expect(Array.isArray(both) && both.map((l) => l.hazard)).toEqual([
      'flood',
      'landslide',
    ]);
  });

  it('says why a row is skipped', () => {
    expect(
      dibiRowToLabels(row({ jenis_bencana: 'Banjir Rob' }), districts),
    ).toBe('not_rain_driven');
    expect(dibiRowToLabels(row({ id_kab_sdi: '99.99' }), districts)).toBe(
      'unknown_region',
    );
    expect(dibiRowToLabels(row({ dt: Number.NaN }), districts)).toBe(
      'bad_timestamp',
    );
  });

  it('queries the event table in the public dashboard context, one year at a time', () => {
    const body = dibiQueryBody(2024, 50_000);
    expect(body.form_data).toEqual(
      expect.objectContaining({ slice_id: 51, dashboardId: 2 }),
    );
    expect(body.queries[0].filters).toContainEqual({
      col: 'tahun',
      op: '==',
      val: 2024,
    });
  });
});
