import { of, throwError } from 'rxjs';
import { HazardType } from '../../common/enums/domain.enum';
import type { IngestedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import { NasaFirmsAdapter, parseFirmsCsv } from './nasa-firms.adapter';

const MODIS_CSV = `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
0.50527,117.22635,313.68,1.03,1.01,2026-10-23,41,Terra,MODIS,68,6.1NRT,295.81,6.24,D
`;
const VIIRS_CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-1.5,113.9,346.49,0.4,0.37,2026-10-23,446,N20,VIIRS,h,2.0NRT,303.35,4.81,D
`;

function ingested(
  id: string,
  lat: number,
  lon: number,
  confidence: string,
  frp: string,
  districts: string[],
): IngestedHazardEvent {
  return {
    hazardEvent: {
      id,
      latitude: lat,
      longitude: lon,
      eventTime: new Date('2026-10-23T05:00:00Z'),
      externalId: id,
      rawPayload: { confidence, frp, satellite: 'N20', instrument: 'VIIRS' },
    } as never,
    announcement: {
      hazardEventId: id,
      hazardType: HazardType.WILDFIRE,
      affectedDistrictIds: districts,
    },
  };
}

describe('NasaFirmsAdapter', () => {
  let http: { get: jest.Mock };
  let configValues: Record<string, string | undefined>;
  let queryBuilder: Record<string, jest.Mock>;
  let adapter: NasaFirmsAdapter;

  beforeEach(() => {
    http = { get: jest.fn() };
    configValues = {
      NASA_FIRMS_API_KEY: 'KEY',
      NASA_FIRMS_BASE_URL: 'https://firms.test/api',
    };
    queryBuilder = {};
    for (const method of ['select', 'where', 'andWhere', 'limit']) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }
    queryBuilder.getMany = jest.fn().mockResolvedValue([]);
    adapter = new NasaFirmsAdapter(
      http as never,
      { get: jest.fn((key: string) => configValues[key]) } as never,
      { createQueryBuilder: jest.fn(() => queryBuilder) } as never,
    );
  });

  describe('fetch', () => {
    it('polls every FIRMS product by default and tags rows by product', async () => {
      http.get.mockImplementation((url: string) =>
        of({ data: url.includes('MODIS') ? MODIS_CSV : VIIRS_CSV }),
      );

      const rows = await adapter.fetch();

      const urls = http.get.mock.calls.map(([url]) => url as string);
      expect(urls).toEqual([
        'https://firms.test/api/area/csv/KEY/MODIS_NRT/94,-12,142,7/1',
        'https://firms.test/api/area/csv/KEY/VIIRS_SNPP_NRT/94,-12,142,7/1',
        'https://firms.test/api/area/csv/KEY/VIIRS_NOAA20_NRT/94,-12,142,7/1',
        'https://firms.test/api/area/csv/KEY/VIIRS_NOAA21_NRT/94,-12,142,7/1',
      ]);
      expect(rows.map((r) => r.firmsSource)).toEqual([
        'MODIS_NRT',
        'VIIRS_SNPP_NRT',
        'VIIRS_NOAA20_NRT',
        'VIIRS_NOAA21_NRT',
      ]);
    });

    it('honours NASA_FIRMS_SOURCES and ignores unknown entries', async () => {
      configValues.NASA_FIRMS_SOURCES = 'viirs_noaa20_nrt, BOGUS';
      http.get.mockReturnValue(of({ data: VIIRS_CSV }));

      await adapter.fetch();

      expect(http.get).toHaveBeenCalledTimes(1);
      expect(http.get.mock.calls[0][0]).toContain('/VIIRS_NOAA20_NRT/');
    });

    it('keeps the other products when one fails', async () => {
      http.get.mockImplementation((url: string) =>
        url.includes('MODIS')
          ? throwError(() => new Error('timeout'))
          : of({ data: VIIRS_CSV }),
      );

      const rows = await adapter.fetch();

      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.firmsSource !== 'MODIS_NRT')).toBe(true);
    });

    it('skips polling without an API key', async () => {
      configValues.NASA_FIRMS_API_KEY = undefined;
      expect(await adapter.fetch()).toEqual([]);
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('normalize', () => {
    it('maps MODIS percentage confidence and brightness', () => {
      const [row] = parseFirmsCsv(MODIS_CSV, 'MODIS_NRT');
      const event = adapter.normalize(row);
      expect(event.details).toEqual({
        frpConfidence: 0.68,
        hotspotCount: 1,
        brightnessKelvin: 313.68,
      });
      expect(event.eventTime.toISOString()).toBe('2026-10-23T00:41:00.000Z');
      expect(event.externalId).toBe('0.50527,117.22635,2026-10-23,41,Terra');
    });

    it('maps VIIRS l/n/h confidence and bright_ti4', () => {
      const [row] = parseFirmsCsv(VIIRS_CSV, 'VIIRS_NOAA20_NRT');
      const event = adapter.normalize(row);
      expect(event.details).toEqual({
        frpConfidence: 0.9,
        hotspotCount: 1,
        brightnessKelvin: 346.49,
      });
      expect(event.rawPayload.firmsSource).toBe('VIIRS_NOAA20_NRT');
      expect(event.externalId).toBe('-1.5,113.9,2026-10-23,446,N20');
      for (const [letter, expected] of [
        ['l', 0.3],
        ['n', 0.6],
      ] as const) {
        expect(
          adapter.normalize({ ...row, confidence: letter }).details
            .frpConfidence,
        ).toBe(expected);
      }
    });

    it('leaves an unrecognized confidence null so validation rejects it', () => {
      const [row] = parseFirmsCsv(VIIRS_CSV, 'VIIRS_SNPP_NRT');
      expect(
        adapter.normalize({ ...row, confidence: '85' }).details.frpConfidence,
      ).toBeNull();
    });
  });

  describe('selectAnnouncements', () => {
    it('announces one event per new cluster, from its strongest detection', async () => {
      const announcements = await adapter.selectAnnouncements([
        ingested('a', -1.5, 113.9, 'n', '4.0', ['d1']),
        ingested('b', -1.51, 113.9, 'h', '9.5', ['d2']),
        ingested('c', -3.0, 104.7, 'n', '2.0', ['d3']),
      ]);

      expect(announcements).toEqual([
        {
          hazardEventId: 'b',
          hazardType: HazardType.WILDFIRE,
          affectedDistrictIds: ['d1', 'd2'],
        },
        {
          hazardEventId: 'c',
          hazardType: HazardType.WILDFIRE,
          affectedDistrictIds: ['d3'],
        },
      ]);
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'e.id NOT IN (:...memberIds)',
        { memberIds: ['a', 'b'] },
      );
    });

    it('never announces low-confidence detections', async () => {
      expect(
        await adapter.selectAnnouncements([
          ingested('a', -1.5, 113.9, 'l', '4.0', ['d1']),
        ]),
      ).toEqual([]);
      expect(queryBuilder.getMany).not.toHaveBeenCalled();
    });

    it('stays silent for a fire already seen nearby', async () => {
      queryBuilder.getMany.mockResolvedValue([
        ingested('old', -1.5, 113.91, 'n', '3.0', []).hazardEvent,
      ]);
      expect(
        await adapter.selectAnnouncements([
          ingested('a', -1.5, 113.9, 'n', '4.0', ['d1']),
        ]),
      ).toEqual([]);
    });

    it('is not silenced by an earlier low-confidence detection', async () => {
      queryBuilder.getMany.mockResolvedValue([
        ingested('old', -1.5, 113.91, 'l', '3.0', []).hazardEvent,
      ]);
      expect(
        await adapter.selectAnnouncements([
          ingested('a', -1.5, 113.9, 'n', '4.0', ['d1']),
        ]),
      ).toHaveLength(1);
    });
  });
});
