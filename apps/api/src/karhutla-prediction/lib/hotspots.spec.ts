import {
  clusterHotspots,
  clusterSeed,
  confidenceClassOf,
  dedupeHotspots,
  normalizeHotspot,
  type HotspotSourceRow,
  type NormalizedHotspot,
} from './hotspots';

function row(overrides: Partial<HotspotSourceRow> = {}): HotspotSourceRow {
  return {
    id: 'e1',
    latitude: -2.2,
    longitude: 113.9,
    eventTime: new Date('2026-09-20T05:00:00Z'),
    externalId: 'x',
    rawPayload: {
      frp: '52.21',
      scan: '1.2',
      track: '1.1',
      confidence: '79',
      satellite: 'Aqua',
      instrument: 'MODIS',
      version: '6.1NRT',
      daynight: 'D',
    },
    ...overrides,
  };
}

function hotspot(
  id: string,
  lat: number,
  lon: number,
  frp = 10,
  at = '2026-09-20T05:00:00Z',
): NormalizedHotspot {
  return normalizeHotspot(
    row({
      id,
      latitude: lat,
      longitude: lon,
      eventTime: new Date(at),
      rawPayload: {
        frp: String(frp),
        confidence: '80',
        satellite: 'Aqua',
        instrument: 'MODIS',
      },
    }),
  )!;
}

describe('normalizeHotspot', () => {
  it('parses FIRMS fields and keeps provenance', () => {
    const h = normalizeHotspot(row())!;
    expect(h).toMatchObject({
      frpMw: 52.21,
      scanKm: 1.2,
      trackKm: 1.1,
      confidence: 0.79,
      confidenceClass: 'nominal',
      satellite: 'Aqua',
      instrument: 'MODIS',
      productVersion: '6.1NRT',
      dayNight: 'D',
    });
    expect(h.observedAt.toISOString()).toBe('2026-09-20T05:00:00.000Z');
  });

  it.each([
    [{ latitude: 95 }],
    [{ longitude: -181 }],
    [{ latitude: Number.NaN }],
    [{ eventTime: new Date('not a date') }],
  ])('rejects invalid coordinates/timestamps %#', (overrides) => {
    expect(
      normalizeHotspot(row(overrides as Partial<HotspotSourceRow>)),
    ).toBeNull();
  });

  it('turns out-of-range or garbage numeric fields into null, not guesses', () => {
    const h = normalizeHotspot(
      row({
        rawPayload: { frp: '-3', scan: 'abc', track: '99', confidence: '' },
      }),
    )!;
    expect(h.frpMw).toBeNull();
    expect(h.scanKm).toBeNull();
    expect(h.trackKm).toBeNull();
    expect(h.confidence).toBeNull();
    expect(h.confidenceClass).toBeNull();
  });
});

describe('confidenceClassOf', () => {
  it('uses FIRMS MODIS thresholds and VIIRS letters', () => {
    expect(confidenceClassOf('29').confidenceClass).toBe('low');
    expect(confidenceClassOf('30').confidenceClass).toBe('nominal');
    expect(confidenceClassOf('80').confidenceClass).toBe('high');
    expect(confidenceClassOf('h')).toEqual({
      confidence: null,
      confidenceClass: 'high',
    });
    expect(confidenceClassOf('l').confidenceClass).toBe('low');
  });
});

describe('dedupeHotspots', () => {
  it('drops repeated detections of the same pixel/time/satellite', () => {
    const a = hotspot('a', -2.2, 113.9);
    const b = { ...hotspot('b', -2.2, 113.9) };
    const c = hotspot('c', -2.2, 113.9, 10, '2026-09-20T06:30:00Z');
    const { unique, duplicates } = dedupeHotspots([a, b, c]);
    expect(unique.map((h) => h.eventId)).toEqual(['a', 'c']);
    expect(duplicates).toBe(1);
  });
});

describe('clusterHotspots', () => {
  it('links hotspots within the link distance and separates distant fires', () => {
    const clusters = clusterHotspots(
      [
        hotspot('a1', -2.2, 113.9, 10),
        hotspot('a2', -2.21, 113.9, 10), // ~1.1 km from a1
        hotspot('a3', -2.22, 113.9, 10), // chains via a2
        hotspot('b1', -3.0, 114.5, 100), // far away, bigger fire
      ],
      2.5,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].hotspots.map((h) => h.eventId)).toEqual(['b1']); // ranked by FRP
    expect(clusters[1].hotspots).toHaveLength(3);
    expect(clusters[1].totalFrpMw).toBe(30);
    expect(clusters[1].radiusKm).toBeGreaterThan(1);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      hotspot('a', -2.2, 113.9),
      hotspot('b', -2.205, 113.9),
      hotspot('c', -2.5, 114),
    ];
    const forward = clusterHotspots(items, 2.5);
    const reversed = clusterHotspots([...items].reverse(), 2.5);
    expect(reversed.map((c) => c.key)).toEqual(forward.map((c) => c.key));
    expect(clusterSeed(forward[0])).toBe(clusterSeed(reversed[0]));
  });
});
