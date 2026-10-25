import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { District } from '../database/entities';

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1';
const CACHE_TTL_MS = 15 * 60 * 1000;
const FORECAST_HOURS = 12;
// Fire points drive the citizen smoke-drift map, which looks up to 48 h
// ahead. Same single Open-Meteo call per batch, just a longer hourly series.
const POINT_FORECAST_HOURS = 48;

interface OpenMeteoWindResponse {
  /** Offset of the response's local times from UTC (0 for timezone=GMT). */
  utc_offset_seconds?: number;
  current?: {
    time: string;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
  };
  hourly?: {
    time: string[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    precipitation: number[];
  };
  daily?: {
    time: string[];
    precipitation_sum: Array<number | null>;
    precipitation_probability_max: Array<number | null>;
    weather_code: Array<number | null>;
  };
}

export interface PublicWeather {
  districtId: string;
  observedAt: string;
  windSpeedKmh: number;
  // Meteorological convention: the direction the wind blows FROM, degrees
  // clockwise from north. Smoke/ash travel toward (value + 180) % 360.
  windFromDeg: number;
  precipitationMm: number;
  hourly: Array<{
    time: string;
    windSpeedKmh: number;
    windFromDeg: number;
    precipitationMm: number;
  }>;
  /** Today and tomorrow in the district's own time zone (WIB/WITA/WIT),
   * district lookups only. */
  daily?: Array<{
    /** Local calendar date, YYYY-MM-DD. */
    date: string;
    precipitationSumMm: number | null;
    precipitationProbabilityMax: number | null;
    /** WMO weather interpretation code. */
    weatherCode: number | null;
  }>;
  source: 'open-meteo';
}

export type PointWind = Omit<PublicWeather, 'districtId' | 'daily'> & {
  latitude: number;
  longitude: number;
};

const WIND_VARIABLES = 'wind_speed_10m,wind_direction_10m,precipitation';
const DAILY_VARIABLES =
  'precipitation_sum,precipitation_probability_max,weather_code';
// Points closer than this share one cached lookup (~11 km) — plenty for
// "which way is the smoke drifting", and keeps a map full of hotspots from
// turning into hundreds of Open-Meteo calls.
const POINT_CACHE_PRECISION = 1;
export const MAX_WIND_POINTS = 30;

/** Open-Meteo returns local times without an offset ("2026-09-29T07:00",
 * in the requested timezone; `utc_offset_seconds` says which). Normalize to
 * an explicit UTC ISO string so clients (apps/web's `new Date(time)`) never
 * read it as browser-local time — Indonesia spans WIB/WITA/WIT, so no single
 * local zone is correct. */
export function toUtcIso(time: string, utcOffsetSeconds = 0): string | null {
  const date = new Date(`${time}${time.endsWith('Z') ? '' : 'Z'}`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - utcOffsetSeconds * 1000).toISOString();
}

/** Exported for tests. */
export function toWind(
  data: OpenMeteoWindResponse,
): Omit<PublicWeather, 'districtId'> | null {
  if (!data.current) return null;
  const offset = data.utc_offset_seconds ?? 0;
  const observedAt = toUtcIso(data.current.time, offset);
  if (!observedAt) return null;
  const hourly = data.hourly;
  const daily = data.daily;
  return {
    observedAt,
    windSpeedKmh: data.current.wind_speed_10m,
    windFromDeg: data.current.wind_direction_10m,
    precipitationMm: data.current.precipitation,
    hourly: hourly
      ? hourly.time.flatMap((rawTime, index) => {
          const time = toUtcIso(rawTime, offset);
          return time
            ? [
                {
                  time,
                  windSpeedKmh: hourly.wind_speed_10m[index],
                  windFromDeg: hourly.wind_direction_10m[index],
                  precipitationMm: hourly.precipitation[index],
                },
              ]
            : [];
        })
      : [],
    ...(daily
      ? {
          daily: daily.time.map((date, index) => ({
            date,
            precipitationSumMm: daily.precipitation_sum[index] ?? null,
            precipitationProbabilityMax:
              daily.precipitation_probability_max[index] ?? null,
            weatherCode: daily.weather_code[index] ?? null,
          })),
        }
      : {}),
    source: 'open-meteo',
  };
}

/**
 * Wind + rain for a district's reference point, for the citizen portal's
 * "where is the smoke/ash heading" hint. Open-Meteo is the same free,
 * keyless source OpenMeteoClient already uses for landslide rainfall; the
 * district point is a single GeoNames reference coordinate (see
 * DistrictRef.geom), so this is "weather around the district", not at the
 * citizen's doorstep. Cached per district for 15 minutes.
 */
@Injectable()
export class PublicWeatherService {
  private readonly logger = new Logger(PublicWeatherService.name);
  private readonly cache = new Map<
    string,
    { at: number; value: PublicWeather }
  >();
  private readonly pointCache = new Map<
    string,
    { at: number; value: PointWind | null }
  >();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
  ) {}

  async getForDistrict(districtId: string): Promise<PublicWeather | null> {
    const cached = this.cache.get(districtId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const district = await this.districtRepository.findOne({
      where: { id: districtId },
    });
    if (!district)
      throw new NotFoundException(`District ${districtId} not found`);
    const coordinates = (
      district.geom as { coordinates?: [number, number] } | null
    )?.coordinates;
    if (!coordinates) return null;
    const [longitude, latitude] = coordinates;

    const baseUrl =
      this.config.get<string>('OPEN_METEO_BASE_URL') ?? DEFAULT_BASE_URL;
    try {
      const { data } = await firstValueFrom(
        this.http.get<OpenMeteoWindResponse>(`${baseUrl}/forecast`, {
          params: {
            latitude,
            longitude,
            current: WIND_VARIABLES,
            hourly: WIND_VARIABLES,
            forecast_hours: FORECAST_HOURS,
            // Today + tomorrow, split at the district's local midnight —
            // hence timezone=auto here; toWind() converts times back to UTC.
            daily: DAILY_VARIABLES,
            forecast_days: 2,
            wind_speed_unit: 'kmh',
            timezone: 'auto',
          },
          timeout: 8_000,
        }),
      );
      const wind = toWind(data);
      if (!wind) return null;
      const value: PublicWeather = { districtId, ...wind };
      this.cache.set(districtId, { at: Date.now(), value });
      return value;
    } catch (error) {
      this.logger.warn(
        `Open-Meteo wind lookup failed for district ${districtId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Wind at arbitrary points (fire clusters for the smoke-drift map). Uncached
   * points go to Open-Meteo in ONE multi-location request (comma-separated
   * coordinates → array response). Points whose lookup fails come back as
   * null rather than failing the whole batch.
   */
  async getWindAt(
    points: Array<{ latitude: number; longitude: number }>,
  ): Promise<Array<PointWind | null>> {
    const now = Date.now();
    const keyOf = (p: { latitude: number; longitude: number }) =>
      `${p.latitude.toFixed(POINT_CACHE_PRECISION)},${p.longitude.toFixed(POINT_CACHE_PRECISION)}`;
    const missing = points.filter((point) => {
      const cached = this.pointCache.get(keyOf(point));
      return !cached || now - cached.at >= CACHE_TTL_MS;
    });
    const uniqueMissing = Array.from(
      new Map(missing.map((point) => [keyOf(point), point])).values(),
    );

    if (uniqueMissing.length > 0) {
      const baseUrl =
        this.config.get<string>('OPEN_METEO_BASE_URL') ?? DEFAULT_BASE_URL;
      try {
        const { data } = await firstValueFrom(
          this.http.get<OpenMeteoWindResponse | OpenMeteoWindResponse[]>(
            `${baseUrl}/forecast`,
            {
              params: {
                latitude: uniqueMissing.map((p) => p.latitude).join(','),
                longitude: uniqueMissing.map((p) => p.longitude).join(','),
                current: WIND_VARIABLES,
                hourly: WIND_VARIABLES,
                forecast_hours: POINT_FORECAST_HOURS,
                wind_speed_unit: 'kmh',
                timezone: 'GMT',
              },
              timeout: 10_000,
            },
          ),
        );
        const results = Array.isArray(data) ? data : [data];
        uniqueMissing.forEach((point, index) => {
          const wind = results[index] ? toWind(results[index]) : null;
          this.pointCache.set(keyOf(point), {
            at: now,
            value: wind ? { ...wind, ...point } : null,
          });
        });
      } catch (error) {
        this.logger.warn(
          `Open-Meteo multi-point wind lookup failed (${uniqueMissing.length} points): ${(error as Error).message}`,
        );
      }
    }

    return points.map((point) => {
      const cached = this.pointCache.get(keyOf(point))?.value;
      return cached ? { ...cached, ...point } : null;
    });
  }
}
