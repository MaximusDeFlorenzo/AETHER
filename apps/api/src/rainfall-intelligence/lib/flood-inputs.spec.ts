import { WeatherDataKind } from '../rainfall.enums';
import {
  assignGaugesToDistricts,
  hazardSamplePoints,
  nationalTerciles,
  parseSiagaLevel,
  selectAntecedentRainfall,
  selectFloodRainfall,
  selectSoilMoisture,
  summarizeHazardSamples,
  type SampleRow,
} from './flood-inputs';
import type { RainfallSourcePriority } from './trailing-rainfall';

const HOUR_MS = 3_600_000;
const NOW = new Date('2026-10-07T02:30:00Z');
const LATEST = new Date('2026-10-07T02:00:00Z');
const PRIORITIES: RainfallSourcePriority[] = [
  {
    source: 'gsmap_gauge_now',
    dataKind: WeatherDataKind.SATELLITE_ESTIMATE,
    ingestionIntervalMs: HOUR_MS,
  },
  {
    source: 'open-meteo',
    dataKind: WeatherDataKind.NWP_MODEL,
    ingestionIntervalMs: 3 * HOUR_MS,
  },
];

/** `hours` consecutive hourly rows ending at `end`, newest last. */
function series(
  hours: number,
  mm: (hoursAgo: number) => number | null,
  end = LATEST,
  soil: number | null = null,
): SampleRow[] {
  return Array.from({ length: hours }, (_, i) => {
    const hoursAgo = hours - 1 - i;
    return {
      validTime: new Date(end.getTime() - hoursAgo * HOUR_MS),
      precipitationMm: mm(hoursAgo),
      soilMoisture9To27cmM3m3: soil,
    };
  });
}

describe('selectFloodRainfall', () => {
  it('prefers the satellite series when its 24 h window is complete', () => {
    const rows = new Map([
      ['gsmap_gauge_now', series(24, (h) => (h === 1 ? 12 : 1))],
      ['open-meteo', series(24, () => 0)],
    ]);
    const rain = selectFloodRainfall(rows, PRIORITIES, NOW);
    expect(rain).toEqual(
      expect.objectContaining({
        source: 'gsmap_gauge_now',
        dataKind: 'satellite_estimate',
        freshness: 'fresh',
        maxHourlyMmLast3Hours: 12,
        validTime: LATEST.toISOString(),
      }),
    );
    expect(rain?.accumulationsMm).toEqual({
      '1': 1,
      '3': 14,
      '6': 17,
      '24': 35,
    });
  });

  it('falls back to a complete model series over an incomplete satellite one', () => {
    const rows = new Map([
      ['gsmap_gauge_now', series(10, () => 2)],
      ['open-meteo', series(24, () => 1)],
    ]);
    const rain = selectFloodRainfall(rows, PRIORITIES, NOW);
    expect(rain?.source).toBe('open-meteo');
    expect(rain?.accumulationsMm['24']).toBe(24);
  });

  it('keeps the incomplete satellite series when nothing is complete', () => {
    const rows = new Map([['gsmap_gauge_now', series(10, () => 2)]]);
    const rain = selectFloodRainfall(rows, PRIORITIES, NOW);
    expect(rain?.source).toBe('gsmap_gauge_now');
    expect(rain?.accumulationsMm['24']).toBeNull();
    expect(rain?.accumulationsMm['6']).toBe(12);
  });

  it('passes a stale series through as stale so the engine can refuse it', () => {
    const old = new Date(LATEST.getTime() - 10 * HOUR_MS);
    const rows = new Map([['gsmap_gauge_now', series(24, () => 5, old)]]);
    expect(selectFloodRainfall(rows, PRIORITIES, NOW)?.freshness).toBe('stale');
    expect(selectFloodRainfall(new Map(), PRIORITIES, NOW)).toBeUndefined();
  });

  it('takes the hourly peak over the hours present', () => {
    const rows = new Map([
      ['gsmap_gauge_now', series(3, (h) => (h === 0 ? null : 7))],
    ]);
    expect(
      selectFloodRainfall(rows, PRIORITIES, NOW)?.maxHourlyMmLast3Hours,
    ).toBe(7);
  });
});

describe('selectAntecedentRainfall / selectSoilMoisture', () => {
  it('uses the first series with a complete 72 h window', () => {
    const rows = new Map([
      ['gsmap_gauge_now', series(24, () => 1)],
      ['open-meteo', series(100, () => 1, LATEST, 0.38)],
    ]);
    expect(selectAntecedentRainfall(rows, PRIORITIES, NOW)).toEqual({
      source: 'open-meteo',
      dataKind: 'nwp_model',
      validTime: LATEST.toISOString(),
      totalMm72Hours: 72,
      totalMm168Hours: null,
    });
    expect(selectSoilMoisture(rows, PRIORITIES, NOW)).toEqual({
      source: 'open-meteo',
      validTime: LATEST.toISOString(),
      volumetricFraction: 0.38,
    });
  });

  it('returns nothing without a complete window or soil value', () => {
    const rows = new Map([['open-meteo', series(48, () => 1)]]);
    expect(selectAntecedentRainfall(rows, PRIORITIES, NOW)).toBeUndefined();
    expect(selectSoilMoisture(rows, PRIORITIES, NOW)).toBeUndefined();
  });
});

describe('nationalTerciles', () => {
  it('splits the distribution into thirds', () => {
    const values = Array.from({ length: 31 }, (_, i) => i / 30);
    expect(nationalTerciles(values)).toEqual([0.333, 0.667]);
  });

  it('refuses too few districts', () => {
    expect(nationalTerciles([0.1, 0.5, 0.9])).toBeNull();
  });
});

describe('parseSiagaLevel', () => {
  it.each([
    ['SIAGA I', 1],
    ['Siaga II', 2],
    [' SIAGA III ', 3],
    ['SIAGA IV', 4],
    ['NORMAL', null],
    ['', null],
    [undefined, null],
  ])('%p → %p', (label, level) => {
    expect(parseSiagaLevel(label)).toBe(level);
  });
});

describe('assignGaugesToDistricts', () => {
  const districts = [
    { id: 'jakarta', latitude: -6.2, longitude: 106.8 },
    { id: 'bogor', latitude: -6.6, longitude: 106.8 },
  ];
  const gauge = (name: string, lat: number, alertLevel: number) => ({
    source: 'petabencana',
    name,
    latitude: lat,
    longitude: 106.8,
    alertLevel,
    observedAt: LATEST,
  });

  it('gives each gauge to its nearest district; most severe wins', () => {
    const result = assignGaugesToDistricts(
      [
        gauge('Manggarai', -6.21, 3),
        gauge('Pluit', -6.15, 2),
        gauge('Katulampa', -6.63, 1),
      ],
      districts,
      30,
    );
    expect(result.get('jakarta')).toEqual(
      expect.objectContaining({ name: 'Pluit', alertLevel: 2 }),
    );
    expect(result.get('bogor')?.name).toBe('Katulampa');
  });

  it('ignores gauges beyond the distance cap', () => {
    expect(
      assignGaugesToDistricts([gauge('Far', -8, 1)], districts, 30).size,
    ).toBe(0);
  });
});

describe('hazard samples', () => {
  it('samples the point and four neighbours', () => {
    expect(hazardSamplePoints(-6, 106, 0.05)).toEqual([
      { latitude: -6, longitude: 106 },
      { latitude: -5.95, longitude: 106 },
      { latitude: -6.05, longitude: 106 },
      { latitude: -6, longitude: 106.05 },
      { latitude: -6, longitude: 105.95 },
    ]);
  });

  it('summarises valid 0–1 values and drops NoData/out-of-range ones', () => {
    expect(summarizeHazardSamples([0.4, null, 0.8, -3.4e38, 0.6])).toEqual({
      valueCenter: 0.4,
      valueMean: 0.6,
      valueMax: 0.8,
      samplesTotal: 5,
      samplesValid: 3,
    });
    expect(summarizeHazardSamples([null, null])).toEqual(
      expect.objectContaining({ valueMean: null, samplesValid: 0 }),
    );
  });
});
