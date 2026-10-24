import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { toUtcIso } from './public-weather.service';

const DEFAULT_BASE_URL = 'https://air-quality-api.open-meteo.com/v1';
const CACHE_TTL_MS = 30 * 60 * 1000;
const FORECAST_HOURS = 24;
const CURRENT_VARIABLES = 'pm2_5,pm10,carbon_monoxide,carbon_dioxide,us_aqi';
// Same ~11 km sharing as wind points: CAMS cells are ~40 km anyway.
const POINT_CACHE_PRECISION = 1;
export const MAX_AIR_QUALITY_POINTS = 30;

const OPENAQ_BASE_URL = 'https://api.openaq.org/v3';
// OpenAQ's maximum search radius.
const STATION_RADIUS_M = 25_000;
// A station that hasn't reported within this is offline, not "clean".
const STATION_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** Indonesian ISPU category (Permen LHK P.14/2020) from PM2.5. */
export type IspuCategory =
  'baik' | 'sedang' | 'tidak_sehat' | 'sangat_tidak_sehat' | 'berbahaya';

// P.14/2020 PM2.5 breakpoints (µg/m³) at ISPU 50/100/200/300. The standard
// is defined on 24-hour averages; this is applied to the modelled hourly
// value, so it reads as "the air right now", not an official ISPU.
const ISPU_PM25: Array<[max: number, category: IspuCategory]> = [
  [15.5, 'baik'],
  [55.4, 'sedang'],
  [150.4, 'tidak_sehat'],
  [250.4, 'sangat_tidak_sehat'],
];

export function ispuCategory(pm25: number): IspuCategory {
  return ISPU_PM25.find(([max]) => pm25 <= max)?.[1] ?? 'berbahaya';
}

interface OpenMeteoAirQualityResponse {
  current?: {
    time: string;
    pm2_5: number | null;
    pm10: number | null;
    carbon_monoxide: number | null;
    carbon_dioxide: number | null;
    us_aqi: number | null;
  };
  hourly?: { time: string[]; pm2_5: Array<number | null> };
}

export interface PointAirQuality {
  latitude: number;
  longitude: number;
  observedAt: string;
  pm25: number | null;
  pm10: number | null;
  /** µg/m³ */
  carbonMonoxide: number | null;
  /** ppm, atmospheric concentration — not an emission. */
  carbonDioxidePpm: number | null;
  usAqi: number | null;
  ispu: IspuCategory | null;
  hourly: Array<{ time: string; pm25: number | null }>;
  source: 'open-meteo-cams';
}

export interface StationAirQuality {
  locationId: number;
  name: string;
  /** e.g. "AirNow", "AirGradient". */
  provider: string;
  /** Reference-grade monitor (true) vs low-cost sensor (false). */
  isMonitor: boolean;
  distanceKm: number;
  measuredAt: string;
  pm25: number | null;
  pm10: number | null;
  ispu: IspuCategory | null;
  source: 'openaq';
}

interface OpenAqLocation {
  id: number;
  name: string | null;
  isMonitor: boolean;
  isMobile: boolean;
  distance?: number;
  provider?: { name: string };
  datetimeLast?: { utc: string } | null;
  sensors: Array<{ id: number; parameter: { name: string } }>;
}

interface OpenAqLatest {
  datetime: { utc: string };
  value: number;
  sensorsId: number;
}

/** Nearest station that reported PM2.5 recently, monitors before sensors
 * at similar distance. Exported for tests. */
export function pickStation(
  locations: OpenAqLocation[],
  now: number,
): OpenAqLocation | null {
  const fresh = locations.filter(
    (l) =>
      !l.isMobile &&
      l.datetimeLast &&
      now - new Date(l.datetimeLast.utc).getTime() <= STATION_MAX_AGE_MS &&
      l.sensors.some((s) => s.parameter.name === 'pm25'),
  );
  // A reference monitor up to 5 km farther still beats a low-cost sensor.
  const score = (l: OpenAqLocation) =>
    (l.distance ?? Infinity) - (l.isMonitor ? 5_000 : 0);
  return fresh.sort((a, b) => score(a) - score(b))[0] ?? null;
}

/** Exported for tests. */
export function toAirQuality(
  data: OpenMeteoAirQualityResponse,
): Omit<PointAirQuality, 'latitude' | 'longitude'> | null {
  if (!data.current) return null;
  const observedAt = toUtcIso(data.current.time);
  if (!observedAt) return null;
  const pm25 = data.current.pm2_5;
  const hourly = data.hourly;
  return {
    observedAt,
    pm25,
    pm10: data.current.pm10,
    carbonMonoxide: data.current.carbon_monoxide,
    carbonDioxidePpm: data.current.carbon_dioxide,
    usAqi: data.current.us_aqi,
    ispu: pm25 === null ? null : ispuCategory(pm25),
    hourly: hourly
      ? hourly.time.flatMap((rawTime, index) => {
          const time = toUtcIso(rawTime);
          return time ? [{ time, pm25: hourly.pm2_5[index] }] : [];
        })
      : [],
    source: 'open-meteo-cams',
  };
}

/**
 * Modelled air quality (CAMS global forecast via Open-Meteo's keyless
 * air-quality API) at arbitrary points — the citizen's own area and the
 * fires on the smoke map. A ~40 km model grid, not a monitoring station:
 * the portal says so. Same batching/caching shape as
 * PublicWeatherService.getWindAt: one multi-location request for uncached
 * points, failed points come back null.
 */
@Injectable()
export class AirQualityService {
  private readonly logger = new Logger(AirQualityService.name);
  private readonly stationCache = new Map<
    string,
    { at: number; value: StationAirQuality | null }
  >();
  private readonly pointCache = new Map<
    string,
    {
      at: number;
      value: Omit<PointAirQuality, 'latitude' | 'longitude'> | null;
    }
  >();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async getAt(
    points: Array<{ latitude: number; longitude: number }>,
  ): Promise<Array<PointAirQuality | null>> {
    const now = Date.now();
    const keyOf = (p: { latitude: number; longitude: number }) =>
      `${p.latitude.toFixed(POINT_CACHE_PRECISION)},${p.longitude.toFixed(POINT_CACHE_PRECISION)}`;
    const uniqueMissing = Array.from(
      new Map(
        points
          .filter((point) => {
            const cached = this.pointCache.get(keyOf(point));
            return !cached || now - cached.at >= CACHE_TTL_MS;
          })
          .map((point) => [keyOf(point), point]),
      ).values(),
    );

    if (uniqueMissing.length > 0) {
      const baseUrl =
        this.config.get<string>('OPEN_METEO_AIR_QUALITY_BASE_URL') ??
        DEFAULT_BASE_URL;
      try {
        const { data } = await firstValueFrom(
          this.http.get<
            OpenMeteoAirQualityResponse | OpenMeteoAirQualityResponse[]
          >(`${baseUrl}/air-quality`, {
            params: {
              latitude: uniqueMissing.map((p) => p.latitude).join(','),
              longitude: uniqueMissing.map((p) => p.longitude).join(','),
              current: CURRENT_VARIABLES,
              hourly: 'pm2_5',
              forecast_hours: FORECAST_HOURS,
              timezone: 'GMT',
            },
            timeout: 10_000,
          }),
        );
        const results = Array.isArray(data) ? data : [data];
        uniqueMissing.forEach((point, index) => {
          this.pointCache.set(keyOf(point), {
            at: now,
            value: results[index] ? toAirQuality(results[index]) : null,
          });
        });
      } catch (error) {
        this.logger.warn(
          `Open-Meteo air-quality lookup failed (${uniqueMissing.length} points): ${(error as Error).message}`,
        );
      }
    }

    return points.map((point) => {
      const cached = this.pointCache.get(keyOf(point))?.value;
      return cached ? { ...cached, ...point } : null;
    });
  }

  /**
   * Measured PM2.5/PM10 from the nearest OpenAQ station that reported in the
   * last 3 h within 25 km — null when there is none (most of Indonesia
   * outside a few cities) or OPENAQ_API_KEY isn't set. Two OpenAQ calls per
   * cache miss (locations + latest); misses are cached too, since OpenAQ
   * allows 60 requests a minute.
   */
  async nearestStation(point: {
    latitude: number;
    longitude: number;
  }): Promise<StationAirQuality | null> {
    const apiKey = this.config.get<string>('OPENAQ_API_KEY');
    if (!apiKey) return null;
    const key = `${point.latitude.toFixed(POINT_CACHE_PRECISION)},${point.longitude.toFixed(POINT_CACHE_PRECISION)}`;
    const cached = this.stationCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const headers = { 'X-API-Key': apiKey };
    let value: StationAirQuality | null = null;
    try {
      const { data: found } = await firstValueFrom(
        this.http.get<{ results: OpenAqLocation[] }>(
          `${OPENAQ_BASE_URL}/locations`,
          {
            params: {
              coordinates: `${point.latitude},${point.longitude}`,
              radius: STATION_RADIUS_M,
              limit: 100,
            },
            headers,
            timeout: 8_000,
          },
        ),
      );
      const station = pickStation(found.results ?? [], Date.now());
      if (station) {
        const { data: latest } = await firstValueFrom(
          this.http.get<{ results: OpenAqLatest[] }>(
            `${OPENAQ_BASE_URL}/locations/${station.id}/latest`,
            { headers, timeout: 8_000 },
          ),
        );
        const reading = (parameter: string) => {
          const sensor = station.sensors.find(
            (s) => s.parameter.name === parameter,
          );
          return (
            latest.results?.find((r) => r.sensorsId === sensor?.id) ?? null
          );
        };
        const pm25 = reading('pm25');
        if (pm25) {
          value = {
            locationId: station.id,
            name: station.name?.trim() || `Stasiun ${station.id}`,
            provider: station.provider?.name ?? 'OpenAQ',
            isMonitor: station.isMonitor,
            distanceKm: Math.round((station.distance ?? 0) / 100) / 10,
            measuredAt: new Date(pm25.datetime.utc).toISOString(),
            pm25: pm25.value,
            pm10: reading('pm10')?.value ?? null,
            ispu: pm25.value >= 0 ? ispuCategory(pm25.value) : null,
            source: 'openaq',
          };
        }
      }
    } catch (error) {
      this.logger.warn(
        `OpenAQ station lookup failed at ${key}: ${(error as Error).message}`,
      );
      // Don't cache a failure as "no station".
      return null;
    }
    this.stationCache.set(key, { at: Date.now(), value });
    return value;
  }
}
