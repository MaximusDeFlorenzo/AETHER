import { WeatherDataKind } from '../rainfall.enums';
import {
  selectTrailing24hRainfall,
  type RainfallRow,
  type RainfallSourcePriority,
} from './trailing-rainfall';

const HOUR_MS = 3_600_000;
const LATEST = new Date('2026-10-06T14:00:00Z');
const NOW = new Date(LATEST.getTime() + 20 * 60_000);

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

function hours(count: number, mm: number, end = LATEST): RainfallRow[] {
  return Array.from({ length: count }, (_, i) => ({
    validTime: new Date(end.getTime() - (count - 1 - i) * HOUR_MS),
    precipitationMm: mm,
  }));
}

describe('selectTrailing24hRainfall', () => {
  it('prefers the satellite estimate when it is complete and fresh', () => {
    const result = selectTrailing24hRainfall(
      new Map([
        ['gsmap_gauge_now', hours(24, 5)],
        ['open-meteo', hours(24, 1)],
      ]),
      PRIORITIES,
      NOW,
    );
    expect(result).toEqual({
      rainfallMm: 120,
      source: 'gsmap_gauge_now',
      dataKind: WeatherDataKind.SATELLITE_ESTIMATE,
      asOf: LATEST,
    });
  });

  it('falls back to the model when the satellite window has a gap', () => {
    const gappy = hours(24, 5).filter((_, i) => i !== 7);
    const result = selectTrailing24hRainfall(
      new Map([
        ['gsmap_gauge_now', gappy],
        ['open-meteo', hours(24, 1)],
      ]),
      PRIORITIES,
      NOW,
    );
    expect(result?.source).toBe('open-meteo');
    expect(result?.rainfallMm).toBe(24);
  });

  it('treats a GSMaP missing-value hour (NULL) as a gap, not zero', () => {
    const rows = hours(24, 5);
    rows[3] = { ...rows[3], precipitationMm: null };
    const result = selectTrailing24hRainfall(
      new Map([['gsmap_gauge_now', rows]]),
      PRIORITIES,
      NOW,
    );
    expect(result).toBeNull();
  });

  it('skips a stale source', () => {
    const old = new Date(LATEST.getTime() - 5 * HOUR_MS);
    const result = selectTrailing24hRainfall(
      new Map([
        ['gsmap_gauge_now', hours(24, 5, old)],
        ['open-meteo', hours(24, 1)],
      ]),
      PRIORITIES,
      NOW,
    );
    // 5 h old is stale for an hourly source (> 2 × 1 h + 1 h) but the
    // 3-hourly model is still fresh.
    expect(result?.source).toBe('open-meteo');
  });

  it('returns null when no source qualifies', () => {
    expect(selectTrailing24hRainfall(new Map(), PRIORITIES, NOW)).toBeNull();
  });
});
