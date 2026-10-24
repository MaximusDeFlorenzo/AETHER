import { WeatherDataKind } from '../rainfall.enums';
import {
  DEFAULT_GSMAP_INGESTION_INTERVAL_MS,
  DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
  OPEN_METEO_SOURCE,
} from '../rainfall.constants';
import {
  accumulate,
  summarizeDataQuality,
  type HourlyValues,
} from './features';

/** `weather_hourly_samples.source` of GSMaP_Gauge_NOW point samples. */
export const GSMAP_GAUGE_SOURCE = 'gsmap_gauge_now';

/**
 * Picks one trailing-24 h rainfall total per district from the stored
 * history, trying sources in priority order. A source is used only if its
 * newest hour is not stale and all 24 hours ending there are present — an
 * incomplete window is skipped, never treated as a lower total.
 */

export interface RainfallSourcePriority {
  source: string;
  dataKind: WeatherDataKind;
  /** That source's ingestion cadence, for freshness. */
  ingestionIntervalMs: number;
}

export interface Trailing24hRainfall {
  rainfallMm: number;
  source: string;
  dataKind: WeatherDataKind;
  /** End of the 24 h window (the source's newest stored hour). */
  asOf: Date;
}

export type RainfallRow = Pick<
  HourlyValues,
  'validTime' | 'precipitationMm'
> & {
  qualityFlags?: string[];
};

export function selectTrailing24hRainfall(
  rowsBySource: Map<string, RainfallRow[]>,
  priorities: RainfallSourcePriority[],
  now: Date,
): Trailing24hRainfall | null {
  for (const priority of priorities) {
    const rows = (rowsBySource.get(priority.source) ?? []).map((row) => ({
      qualityFlags: [],
      ...row,
    })) as HourlyValues[];
    if (rows.length === 0) continue;
    const quality = summarizeDataQuality(
      rows,
      now,
      priority.ingestionIntervalMs,
    );
    if (!quality.latestValidTime || quality.freshness === 'stale') continue;
    const asOf = new Date(quality.latestValidTime);
    const window = accumulate(rows, asOf, 24);
    if (window.totalMm === null) continue;
    return {
      rainfallMm: window.totalMm,
      source: priority.source,
      dataKind: priority.dataKind,
      asOf,
    };
  }
  return null;
}

/**
 * Rainfall series in the order every consumer prefers them: the
 * gauge-adjusted satellite estimate (closest to an observation) first, NWP
 * model values second. Intervals come from the same env vars the
 * ingestion schedulers use.
 */
export function rainfallSourcePriorities(
  get: (envVar: string) => unknown,
): RainfallSourcePriority[] {
  const interval = (envVar: string, fallback: number) => {
    const configured = Number(get(envVar) ?? fallback);
    return configured > 0 ? configured : fallback;
  };
  return [
    {
      source: GSMAP_GAUGE_SOURCE,
      dataKind: WeatherDataKind.SATELLITE_ESTIMATE,
      ingestionIntervalMs: interval(
        'GSMAP_INGESTION_INTERVAL_MS',
        DEFAULT_GSMAP_INGESTION_INTERVAL_MS,
      ),
    },
    {
      source: OPEN_METEO_SOURCE,
      dataKind: WeatherDataKind.NWP_MODEL,
      ingestionIntervalMs: interval(
        'RAINFALL_INGESTION_INTERVAL_MS',
        DEFAULT_RAINFALL_INGESTION_INTERVAL_MS,
      ),
    },
  ];
}
