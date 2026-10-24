import {
  buildRainfallRecommendations,
  type FloodSummary,
  type LandslideSummary,
  type RainSummary,
} from './rainfall-recommendations';

const flood = (over: Partial<FloodSummary> = {}): FloodSummary => ({
  status: 'ok',
  level: 'LOW',
  confidence: 'low',
  confidenceReasons: ['thresholds not calibrated'],
  raisedBy: [],
  gauge: null,
  ...over,
});
const landslide = (over: Partial<LandslideSummary> = {}): LandslideSummary => ({
  status: 'ok',
  level: 'LOW',
  confidence: 'low',
  confidenceReasons: [],
  raisedBy: [],
  terrainClass: 'high',
  ...over,
});
const rain = (over: Partial<RainSummary> = {}): RainSummary => ({
  currentMmPerHour: 0,
  nextHourProbability: 0,
  method: 'motion_advection',
  calibrated: false,
  freshness: 'fresh',
  ...over,
});
const codes = (recs: Array<{ code: string }>) => recs.map((r) => r.code);

describe('buildRainfallRecommendations', () => {
  it('always tells responders to cross-check official warnings, and says LOW is not an all-clear', () => {
    const recs = buildRainfallRecommendations({
      flood: flood(),
      landslide: landslide(),
      rain: rain(),
    });
    expect(codes(recs)).toEqual([
      'CHECK_OFFICIAL_WARNINGS',
      'NO_TRIGGER_DETECTED',
    ]);
    expect(recs[1].text).toMatch(/not an all-clear/);
  });

  it('flood MEDIUM → monitor; HIGH → prepare + BNPB public actions, citing what raised it', () => {
    expect(
      codes(
        buildRainfallRecommendations({
          flood: flood({ level: 'MEDIUM' }),
          landslide: null,
          rain: null,
        }),
      ),
    ).toContain('FLOOD_MONITOR');
    const recs = buildRainfallRecommendations({
      flood: flood({
        level: 'HIGH',
        raisedBy: ['rain_24h 120 mm (sangat_lebat)'],
      }),
      landslide: null,
      rain: null,
    });
    expect(codes(recs)).toEqual(
      expect.arrayContaining(['FLOOD_PREPARE', 'FLOOD_PUBLIC_ACTIONS']),
    );
    expect(codes(recs)).not.toContain('FLOOD_MONITOR');
    const publicRec = recs.find((r) => r.code === 'FLOOD_PUBLIC_ACTIONS')!;
    expect(publicRec.audience).toBe('public');
    expect(publicRec.basis).toMatch(/rain_24h 120 mm .*Buku Saku/);
  });

  it('names an official gauge alert', () => {
    const recs = buildRainfallRecommendations({
      flood: flood({
        level: 'HIGH',
        gauge: { name: 'Manggarai', label: 'Siaga II' },
      }),
      landslide: null,
      rain: null,
    });
    expect(recs.find((r) => r.code === 'FLOOD_GAUGE_ALERT')?.text).toMatch(
      /Manggarai reports Siaga II/,
    );
  });

  it('landslide MEDIUM → monitor + BNPB warning signs; HIGH → prepare; unknown terrain is said', () => {
    const medium = buildRainfallRecommendations({
      flood: null,
      landslide: landslide({ level: 'MEDIUM', terrainClass: 'unknown' }),
      rain: null,
    });
    expect(codes(medium)).toEqual(
      expect.arrayContaining(['LANDSLIDE_MONITOR', 'LANDSLIDE_WARNING_SIGNS']),
    );
    expect(medium.find((r) => r.code === 'LANDSLIDE_MONITOR')?.text).toMatch(
      /slope is not yet known/,
    );
    expect(
      medium.find((r) => r.code === 'LANDSLIDE_WARNING_SIGNS')?.priority,
    ).toBe('info');
    const high = buildRainfallRecommendations({
      flood: null,
      landslide: landslide({ level: 'HIGH' }),
      rain: null,
    });
    expect(codes(high)).toContain('LANDSLIDE_PREPARE');
    expect(
      high.find((r) => r.code === 'LANDSLIDE_WARNING_SIGNS')?.priority,
    ).toBe('advisory');
  });

  it('adds "more rain indicated" only when a trigger is already met', () => {
    const wet = rain({ nextHourProbability: 0.6 });
    expect(
      codes(
        buildRainfallRecommendations({
          flood: flood({ level: 'MEDIUM' }),
          landslide: null,
          rain: wet,
        }),
      ),
    ).toContain('MORE_RAIN_INDICATED');
    expect(
      codes(
        buildRainfallRecommendations({
          flood: flood(),
          landslide: landslide(),
          rain: wet,
        }),
      ),
    ).not.toContain('MORE_RAIN_INDICATED');
    expect(
      codes(
        buildRainfallRecommendations({
          flood: flood({ level: 'MEDIUM' }),
          landslide: null,
          rain: rain({ nextHourProbability: 0.4 }),
        }),
      ),
    ).not.toContain('MORE_RAIN_INDICATED');
  });

  it('flags degraded, stale and missing inputs', () => {
    const degraded = buildRainfallRecommendations({
      flood: flood({
        level: 'MEDIUM',
        confidence: 'very_low',
        confidenceReasons: [
          'rainfall data is aging',
          'thresholds not calibrated against local flood history',
        ],
      }),
      landslide: null,
      rain: rain({ freshness: 'stale' }),
    });
    expect(codes(degraded)).toEqual(
      expect.arrayContaining(['DEGRADED_INPUTS', 'REFRESH_OBSERVATION']),
    );
    // Always-true reasons (no calibration) are not listed as degradation.
    expect(degraded.find((r) => r.code === 'DEGRADED_INPUTS')?.basis).toBe(
      'Confidence "very_low": rainfall data is aging.',
    );
    const missing = buildRainfallRecommendations({
      flood: flood({ status: 'insufficient_data', level: null }),
      landslide: null,
      rain: null,
    });
    expect(codes(missing)).toEqual([
      'CHECK_OFFICIAL_WARNINGS',
      'OUTLOOK_UNAVAILABLE',
    ]);
  });

  it('never orders an evacuation and always states a basis', () => {
    const recs = buildRainfallRecommendations({
      flood: flood({
        level: 'EXTREME',
        gauge: { name: 'X', label: 'Siaga I' },
      }),
      landslide: landslide({ level: 'HIGH' }),
      rain: rain({ nextHourProbability: 0.9 }),
    });
    for (const rec of recs) {
      expect(rec.basis.length).toBeGreaterThan(0);
      expect(rec.text).not.toMatch(/\bevacuate now\b|\bmust evacuate\b/i);
    }
    const prepares = recs.filter((r) => r.code.endsWith('_PREPARE'));
    for (const rec of prepares) {
      expect(rec.text).toMatch(/Do not order evacuations/);
      expect(rec.textId).toMatch(/Jangan memerintahkan evakuasi/);
    }
  });

  it('renders every recommendation in Bahasa Indonesia, with the same facts', () => {
    const recs = buildRainfallRecommendations({
      flood: flood({
        level: 'HIGH',
        gauge: { name: 'Manggarai', label: 'Siaga II' },
        confidence: 'very_low',
        confidenceReasons: ['rainfall data is aging'],
      }),
      landslide: landslide({ level: 'MEDIUM', terrainClass: 'unknown' }),
      rain: rain({ nextHourProbability: 0.8, freshness: 'aging' }),
    });
    expect(recs.length).toBeGreaterThan(8);
    for (const rec of recs) {
      expect(rec.textId.length).toBeGreaterThan(0);
      expect(rec.textId).not.toEqual(rec.text);
    }
    const byCode = (code: string) => recs.find((r) => r.code === code)!;
    expect(byCode('FLOOD_GAUGE_ALERT').textId).toMatch(
      /Manggarai melaporkan Siaga II/,
    );
    expect(byCode('LANDSLIDE_MONITOR').textId).toMatch(/belum diketahui/);
    expect(byCode('LANDSLIDE_WARNING_SIGNS').textId).toMatch(
      /retakan .* air sumur .* keruh/,
    );
  });
});
