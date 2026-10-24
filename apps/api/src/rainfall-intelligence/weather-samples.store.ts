import { Repository } from 'typeorm';
import { District, WeatherHourlySample } from '../database/entities';
import type { SampleRow } from './lib/flood-inputs';

/**
 * Persistence helpers shared by every `weather_hourly_samples` writer
 * (Open-Meteo and GSMaP ingestion), so all sources key, chunk and upsert
 * rows the same way.
 */

// Keeps each INSERT well under Postgres' 65,535 bind-parameter limit
// (~21 columns per row).
const INSERT_CHUNK_ROWS = 2000;

const UPDATABLE_COLUMNS = [
  'data_kind',
  'latitude',
  'longitude',
  'grid_elevation_m',
  'precipitation_mm',
  'wind_speed_10m_kmh',
  'wind_from_10m_deg',
  'wind_speed_850hpa_kmh',
  'wind_from_850hpa_deg',
  'wind_speed_700hpa_kmh',
  'wind_from_700hpa_deg',
  'temperature_c',
  'relative_humidity_pct',
  'surface_pressure_hpa',
  'soil_moisture_9_27cm_m3m3',
  'quality_flags',
  'retrieved_at',
  'updated_at',
];

export interface DistrictPoint {
  id: string;
  latitude: number;
  longitude: number;
}

/** Idempotent on (district, source, valid_time): re-ingesting an hour
 * replaces its values. Returns the number of rows written. */
export async function upsertHourlySamples(
  repository: Repository<WeatherHourlySample>,
  rows: Array<Partial<WeatherHourlySample>>,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_ROWS);
    await repository
      .createQueryBuilder()
      .insert()
      .into(WeatherHourlySample)
      .values(chunk)
      .orUpdate(UPDATABLE_COLUMNS, ['district_id', 'source', 'valid_time'])
      .execute();
    written += chunk.length;
  }
  return written;
}

/**
 * Every kabupaten/kota reference point. `districts.geom` is a single
 * GeoNames POINT per district (no boundaries exist — docs/ARCHITECTURE.md
 * §5); ST_Centroid is a no-op on a point and keeps this correct if polygons
 * arrive later.
 */
export async function getDistrictPoints(
  repository: Repository<District>,
): Promise<DistrictPoint[]> {
  const rows = await repository
    .createQueryBuilder('d')
    .select('d.id', 'id')
    .addSelect('ST_Y(ST_Centroid(d.geom))', 'latitude')
    .addSelect('ST_X(ST_Centroid(d.geom))', 'longitude')
    .orderBy('d.bps_code', 'ASC')
    .getRawMany<{ id: string; latitude: string; longitude: string }>();
  return rows
    .map((r) => ({
      id: r.id,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    }))
    .filter((d) => Number.isFinite(d.latitude) && Number.isFinite(d.longitude));
}

/**
 * Stored precipitation + soil moisture since `from` for the given sources,
 * as district id → source → rows (the flood and landslide baselines' input).
 */
export async function loadRainfallSamples(
  repository: Repository<WeatherHourlySample>,
  sources: string[],
  from: Date,
): Promise<Map<string, Map<string, SampleRow[]>>> {
  const rows = await repository.query<
    Array<{
      district_id: string;
      source: string;
      valid_time: Date;
      precipitation_mm: number | null;
      soil_moisture_9_27cm_m3m3: number | null;
    }>
  >(
    `SELECT district_id, source, valid_time, precipitation_mm,
            soil_moisture_9_27cm_m3m3
     FROM weather_hourly_samples
     WHERE source = ANY($1) AND valid_time > $2`,
    [sources, from],
  );
  const byDistrict = new Map<string, Map<string, SampleRow[]>>();
  for (const row of rows) {
    const bySource =
      byDistrict.get(row.district_id) ?? new Map<string, SampleRow[]>();
    const list = bySource.get(row.source) ?? [];
    list.push({
      validTime: new Date(row.valid_time),
      precipitationMm: row.precipitation_mm,
      soilMoisture9To27cmM3m3: row.soil_moisture_9_27cm_m3m3,
    });
    bySource.set(row.source, list);
    byDistrict.set(row.district_id, bySource);
  }
  return byDistrict;
}
