import { Repository } from 'typeorm';
import { RainfallGrid, WeatherHourlySample } from '../database/entities';
import type { GridDomain } from './lib/gsmap';
import { decodeRainGrid } from './lib/rain-grid-codec';
import { OPEN_METEO_SOURCE } from './rainfall.constants';

/** Stored inputs for rain nowcasting and its backtest. */

export interface DecodedRainGrid {
  validTime: Date;
  domain: GridDomain;
  values: Float32Array;
  missingCells: number;
}

export interface WindLevel {
  speedKmh: number;
  fromDeg: number;
}

export interface WindHour {
  validTime: Date;
  '10m': WindLevel | null;
  '850hPa': WindLevel | null;
  '700hPa': WindLevel | null;
}

export async function loadRainGrids(
  repository: Repository<RainfallGrid>,
  source: string,
  from: Date,
  to: Date,
): Promise<DecodedRainGrid[]> {
  const rows = await repository
    .createQueryBuilder('g')
    .where('g.source = :source', { source })
    .andWhere('g.valid_time >= :from AND g.valid_time <= :to', { from, to })
    .orderBy('g.valid_time', 'ASC')
    .getMany();
  return rows.map((row) => ({
    validTime: row.validTime,
    domain: {
      westLon: row.westLon,
      northLat: row.northLat,
      resolutionDeg: row.resolutionDeg,
      nx: row.nx,
      ny: row.ny,
    },
    values: decodeRainGrid(row.data, row.nx * row.ny),
    missingCells: row.missingCells,
  }));
}

/** Open-Meteo winds per district, ascending by time. */
export async function loadWindHistory(
  repository: Repository<WeatherHourlySample>,
  from: Date,
  to: Date,
): Promise<Map<string, WindHour[]>> {
  const rows = await repository.query<
    Array<{
      district_id: string;
      valid_time: Date;
      wind_speed_10m_kmh: number | null;
      wind_from_10m_deg: number | null;
      wind_speed_850hpa_kmh: number | null;
      wind_from_850hpa_deg: number | null;
      wind_speed_700hpa_kmh: number | null;
      wind_from_700hpa_deg: number | null;
    }>
  >(
    `SELECT district_id, valid_time,
            wind_speed_10m_kmh, wind_from_10m_deg,
            wind_speed_850hpa_kmh, wind_from_850hpa_deg,
            wind_speed_700hpa_kmh, wind_from_700hpa_deg
     FROM weather_hourly_samples
     WHERE source = $1 AND valid_time >= $2 AND valid_time <= $3
     ORDER BY district_id, valid_time`,
    [OPEN_METEO_SOURCE, from, to],
  );
  const level = (
    speed: number | null,
    from: number | null,
  ): WindLevel | null =>
    speed === null || from === null ? null : { speedKmh: speed, fromDeg: from };
  const history = new Map<string, WindHour[]>();
  for (const row of rows) {
    const list = history.get(row.district_id) ?? [];
    list.push({
      validTime: new Date(row.valid_time),
      '10m': level(row.wind_speed_10m_kmh, row.wind_from_10m_deg),
      '850hPa': level(row.wind_speed_850hpa_kmh, row.wind_from_850hpa_deg),
      '700hPa': level(row.wind_speed_700hpa_kmh, row.wind_from_700hpa_deg),
    });
    history.set(row.district_id, list);
  }
  return history;
}

/**
 * The newest wind hour at or before `at`, no older than `maxAgeMs` (model
 * winds are ingested every few hours, so the exact hour is often not stored
 * yet). Pure; `hours` ascending.
 */
export function windAt(
  hours: WindHour[] | undefined,
  at: Date,
  maxAgeMs: number,
): WindHour | null {
  if (!hours) return null;
  for (let i = hours.length - 1; i >= 0; i--) {
    const t = hours[i].validTime.getTime();
    if (t > at.getTime()) continue;
    return at.getTime() - t <= maxAgeMs ? hours[i] : null;
  }
  return null;
}
