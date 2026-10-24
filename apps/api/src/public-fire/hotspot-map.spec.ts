import {
  buildHotspotMap,
  estimateCo2TonnesPerHour,
  peakOverpassFrp,
  sensorLabel,
} from './hotspot-map';

const window = {
  from: new Date('2026-10-22T12:00:00Z'),
  to: new Date('2026-10-23T12:00:00Z'),
  hours: 24,
};

function row(
  id: string,
  lat: number,
  lng: number,
  raw: Record<string, unknown>,
  time = '2026-10-23T06:00:00Z',
) {
  return {
    id,
    latitude: lat,
    longitude: lng,
    eventTime: new Date(time),
    externalId: id,
    rawPayload: { frp: '5', ...raw },
  };
}

const districts = [
  {
    id: 'd-pulpis',
    name: 'Kabupaten Pulang Pisau',
    provinceName: 'Kalimantan Tengah',
    latitude: -2.75,
    longitude: 114.0,
  },
];

describe('buildHotspotMap', () => {
  const map = buildHotspotMap(
    [
      row('a', -2.5, 114.0, {
        satellite: 'N20',
        instrument: 'VIIRS',
        confidence: 'h',
        frp: '20',
      }),
      row('b', -2.51, 114.0, {
        satellite: 'Aqua',
        instrument: 'MODIS',
        confidence: '55',
      }),
      row('c', -2.6, 114.3, {
        satellite: 'N',
        instrument: 'VIIRS',
        confidence: 'l',
      }),
      row('d', 2.5, 113.0, {
        satellite: 'N21',
        instrument: 'VIIRS',
        confidence: 'n',
      }),
    ],
    districts,
    window,
  );

  it('excludes low confidence and clusters the rest', () => {
    expect(map.totals).toEqual({
      detections: 3,
      lowConfidenceExcluded: 1,
      clusters: 2,
      clustersInIndonesia: 1,
    });
  });

  it('labels a cross-sensor Indonesian cluster', () => {
    const [kalteng] = map.clusters;
    expect(kalteng).toMatchObject({
      detections: 2,
      totalFrpMw: 25,
      confidenceClass: 'high',
      sensors: ['MODIS Aqua', 'VIIRS NOAA-20'],
      country: { iso: 'IDN', name: 'Indonesia' },
      insideIndonesia: true,
      nearestDistrict: { id: 'd-pulpis', distanceKm: 27 },
    });
    expect(kalteng.hotspotEventIds.sort()).toEqual(['a', 'b']);
  });

  it('labels a foreign cluster without an Indonesian district', () => {
    expect(map.clusters[1]).toMatchObject({
      country: { iso: 'MYS' },
      insideIndonesia: false,
      nearestDistrict: null,
    });
  });

  it('summarises detections per satellite', () => {
    expect(map.sensors.map((s) => [s.label, s.detections])).toEqual([
      ['MODIS Aqua', 1],
      ['VIIRS NOAA-20', 1],
      ['VIIRS NOAA-21', 1],
    ]);
  });
});

describe('sensorLabel', () => {
  it('falls back to instrument + satellite for unknown codes', () => {
    expect(sensorLabel({ satellite: 'X9', instrument: 'VIIRS' } as never)).toBe(
      'VIIRS X9',
    );
  });
});

describe('fire emission estimate', () => {
  const base = {
    eventId: 'x',
    latitude: -2.5,
    longitude: 114,
    scanKm: null,
    trackKm: null,
    confidence: null,
    confidenceClass: 'nominal' as const,
    instrument: 'VIIRS',
    productVersion: null,
    dayNight: 'D' as const,
  };
  const at = (iso: string, satellite: string, frpMw: number | null) => ({
    ...base,
    observedAt: new Date(iso),
    satellite,
    frpMw,
  });

  it('takes the strongest single overpass, not the window total', () => {
    const peak = peakOverpassFrp([
      // NOAA-20 overpass: two pixels, 30 MW together
      at('2026-10-23T05:40:00Z', 'N20', 10),
      at('2026-10-23T05:41:00Z', 'N20', 20),
      // S-NPP sees the same fire 50 min later: 25 MW
      at('2026-10-23T06:30:00Z', 'N', 25),
      // NOAA-20 again 12 h later: 5 MW
      at('2026-10-23T17:40:00Z', 'N20', 5),
      at('2026-10-23T17:41:00Z', 'N20', null),
    ]);
    expect(peak).toBe(30);
  });

  it('is null when no detection reports FRP', () => {
    expect(
      peakOverpassFrp([at('2026-10-23T05:40:00Z', 'N20', null)]),
    ).toBeNull();
  });

  it('converts FRP to a CO2 rate (~2.15 t/h per MW)', () => {
    expect(estimateCo2TonnesPerHour(100)).toBeCloseTo(214.6, 1);
  });
});
