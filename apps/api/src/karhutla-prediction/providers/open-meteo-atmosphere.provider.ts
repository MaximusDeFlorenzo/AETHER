import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { withRetry } from './retry';

/**
 * Hourly surface + multi-level atmosphere for the karhutla engines, from
 * Open-Meteo's forecast API (keyless; the same source PublicWeatherService
 * and OpenMeteoClient already use). Values are numerical-weather-prediction
 * model output (Open-Meteo "best_match" blend, e.g. ECMWF IFS / GFS), not
 * station observations — `provenance.kind` says so, and past hours are
 * model analyses/short-range forecasts, not measurements.
 *
 * Every value is validated and unit-checked against Open-Meteo's own
 * `hourly_units`; an invalid value becomes null (or drops the hour, if it's
 * the 10 m wind), never a guess.
 */

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1';
// Fixed window so cache entries are interchangeable between runs: enough
// history to reach a hotspot observed up to 24 h ago, enough future for the
// longest supported horizon (12 h) plus interpolation slack.
const PAST_HOURS = 25;
const FORECAST_HOURS = 14;
const CACHE_TTL_MS = 30 * 60 * 1000;
// When a refresh fails, an older cached series may still be served (its
// `retrievedAt` travels with it and data-quality flags the age) — but
// never one older than this.
const MAX_STALE_MS = 6 * 60 * 60 * 1000;
const MAX_LOCATIONS_PER_REQUEST = 50;
const PRESSURE_LEVELS = [925, 850, 700] as const;
// A pressure level whose geopotential height is this close to (or below)
// the ground is underground/terrain-contaminated at that point: dropped.
const MIN_LEVEL_AGL_M = 50;

const HOURLY_VARIABLES = [
  'wind_speed_10m',
  'wind_direction_10m',
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'boundary_layer_height',
  ...PRESSURE_LEVELS.flatMap((p) => [
    `wind_speed_${p}hPa`,
    `wind_direction_${p}hPa`,
    `geopotential_height_${p}hPa`,
  ]),
];

export const SPEED_TO_KMH: Record<string, number> = {
  'km/h': 1,
  'm/s': 3.6,
  kn: 1.852,
  'mp/h': 1.609344,
};

export interface WindLevel {
  heightAglM: number;
  windSpeedKmh: number;
  windFromDeg: number;
}

export interface AtmosphereHour {
  time: string; // ISO 8601, UTC
  windSpeed10mKmh: number;
  windFrom10mDeg: number;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  precipitationMm: number | null;
  boundaryLayerHeightM: number | null;
  levels: WindLevel[];
}

export interface AtmosphereSeries {
  latitude: number;
  longitude: number;
  /** Model grid-cell elevation Open-Meteo reports, metres ASL. */
  elevationM: number | null;
  retrievedAt: string;
  hours: AtmosphereHour[];
}

export interface AtmosphereProvenance {
  provider: 'open-meteo';
  kind: 'nwp_model';
  model: 'best_match';
  attribution: string;
  variables: string[];
}

export const OPEN_METEO_PROVENANCE: AtmosphereProvenance = {
  provider: 'open-meteo',
  kind: 'nwp_model',
  model: 'best_match',
  attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
  variables: HOURLY_VARIABLES,
};

type HourlyBlock = Record<string, Array<number | null> | string[] | undefined>;
interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  hourly_units?: Record<string, string>;
  hourly?: HourlyBlock & { time: string[] };
}

export function finiteIn(
  value: unknown,
  min: number,
  max: number,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** Pure parser, exported for tests. Returns null if the response has no
 * usable hourly block or an unrecognised wind speed unit. */
export function parseOpenMeteoAtmosphere(
  data: OpenMeteoResponse,
  requested: { latitude: number; longitude: number },
  retrievedAt: Date,
): AtmosphereSeries | null {
  const hourly = data.hourly;
  if (!hourly?.time?.length) return null;
  const units = data.hourly_units ?? {};
  const speedFactor = (variable: string) =>
    SPEED_TO_KMH[units[variable] ?? 'km/h'];
  if (speedFactor('wind_speed_10m') === undefined) return null;

  const elevation = finiteIn(data.elevation, -500, 9000);
  const series = (name: string) => (hourly[name] ?? []) as Array<number | null>;

  const hours: AtmosphereHour[] = [];
  hourly.time.forEach((time, i) => {
    const speed = finiteIn(series('wind_speed_10m')[i], 0, 400);
    const from = finiteIn(series('wind_direction_10m')[i], 0, 360);
    if (speed === null || from === null) return;
    const iso = new Date(`${time}${time.endsWith('Z') ? '' : 'Z'}`);
    if (Number.isNaN(iso.getTime())) return;

    const levels: WindLevel[] = [
      {
        heightAglM: 10,
        windSpeedKmh: speed * speedFactor('wind_speed_10m'),
        windFromDeg: from,
      },
    ];
    for (const p of PRESSURE_LEVELS) {
      const factor = speedFactor(`wind_speed_${p}hPa`);
      const ls = finiteIn(series(`wind_speed_${p}hPa`)[i], 0, 400);
      const ld = finiteIn(series(`wind_direction_${p}hPa`)[i], 0, 360);
      const gph = finiteIn(
        series(`geopotential_height_${p}hPa`)[i],
        -500,
        20000,
      );
      if (factor === undefined || ls === null || ld === null || gph === null)
        continue;
      const agl = gph - (elevation ?? 0);
      if (agl < MIN_LEVEL_AGL_M) continue;
      levels.push({
        heightAglM: Math.round(agl),
        windSpeedKmh: ls * factor,
        windFromDeg: ld,
      });
    }

    hours.push({
      time: iso.toISOString(),
      windSpeed10mKmh: speed * speedFactor('wind_speed_10m'),
      windFrom10mDeg: from,
      temperatureC: finiteIn(series('temperature_2m')[i], -40, 60),
      relativeHumidityPct: finiteIn(series('relative_humidity_2m')[i], 0, 100),
      precipitationMm: finiteIn(series('precipitation')[i], 0, 500),
      boundaryLayerHeightM: finiteIn(
        series('boundary_layer_height')[i],
        0,
        6000,
      ),
      levels,
    });
  });

  if (!hours.length) return null;
  return {
    latitude: requested.latitude,
    longitude: requested.longitude,
    elevationM: elevation,
    retrievedAt: retrievedAt.toISOString(),
    hours,
  };
}

@Injectable()
export class OpenMeteoAtmosphereProvider {
  private readonly logger = new Logger(OpenMeteoAtmosphereProvider.name);
  private readonly cache = new Map<
    string,
    { at: number; value: AtmosphereSeries | null }
  >();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private keyOf(p: { latitude: number; longitude: number }) {
    return `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
  }

  /** Same order as `points`; a point whose lookup failed is null. */
  async fetch(
    points: Array<{ latitude: number; longitude: number }>,
  ): Promise<Array<AtmosphereSeries | null>> {
    const now = Date.now();
    const missing = Array.from(
      new Map(
        points
          .filter((p) => {
            const hit = this.cache.get(this.keyOf(p));
            return !hit || now - hit.at >= CACHE_TTL_MS;
          })
          .map((p) => [this.keyOf(p), p]),
      ).values(),
    );

    const baseUrl =
      this.config.get<string>('OPEN_METEO_BASE_URL') ?? DEFAULT_BASE_URL;
    for (let i = 0; i < missing.length; i += MAX_LOCATIONS_PER_REQUEST) {
      const batch = missing.slice(i, i + MAX_LOCATIONS_PER_REQUEST);
      try {
        const { data } = await withRetry(() =>
          firstValueFrom(
            this.http.get<OpenMeteoResponse | OpenMeteoResponse[]>(
              `${baseUrl}/forecast`,
              {
                params: {
                  latitude: batch.map((p) => p.latitude).join(','),
                  longitude: batch.map((p) => p.longitude).join(','),
                  hourly: HOURLY_VARIABLES.join(','),
                  past_hours: PAST_HOURS,
                  forecast_hours: FORECAST_HOURS,
                  wind_speed_unit: 'kmh',
                  timezone: 'GMT',
                },
                timeout: 20_000,
              },
            ),
          ),
        );
        const results = Array.isArray(data) ? data : [data];
        const retrievedAt = new Date();
        batch.forEach((point, index) => {
          const parsed = results[index]
            ? parseOpenMeteoAtmosphere(results[index], point, retrievedAt)
            : null;
          this.cache.set(this.keyOf(point), {
            at: retrievedAt.getTime(),
            value: parsed,
          });
        });
      } catch (error) {
        this.logger.warn(
          `Open-Meteo atmosphere fetch failed for ${batch.length} point(s): ${(error as Error).message}`,
        );
      }
    }

    return points.map((p) => {
      const hit = this.cache.get(this.keyOf(p));
      if (!hit?.value || Date.now() - hit.at > MAX_STALE_MS) return null;
      return { ...hit.value, latitude: p.latitude, longitude: p.longitude };
    });
  }
}
