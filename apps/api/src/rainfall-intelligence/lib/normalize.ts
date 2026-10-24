import {
  finiteIn,
  SPEED_TO_KMH,
} from '../../karhutla-prediction/providers/open-meteo-atmosphere.provider';
import { normalizeDirectionDeg } from './wind';

/**
 * Pure parser/validator for one location of an Open-Meteo hourly response
 * (`timezone=GMT`). It never "fixes" a value: anything with an unknown
 * unit or outside physical bounds becomes null with a reason in
 * `qualityFlags`, so downstream code can count and report it.
 */

// 11 variables — Open-Meteo counts > 10 variables as a fractional extra
// call (1.1 here), see docs/RAINFALL_INTELLIGENCE.md "Provider quota".
export const OPEN_METEO_HOURLY_VARIABLES = [
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_speed_850hPa',
  'wind_direction_850hPa',
  'wind_speed_700hPa',
  'wind_direction_700hPa',
  'temperature_2m',
  'relative_humidity_2m',
  'surface_pressure',
  'soil_moisture_9_to_27cm',
] as const;

// Physical plausibility bounds. Deliberately loose — they reject sensor/
// decoding garbage, not unusual weather.
// ~305 mm is the world-record 1-hour rainfall; anything above is invalid.
const MAX_HOURLY_PRECIPITATION_MM = 305;
const MAX_WIND_KMH = 400;
// Indonesia spans sea level to Puncak Jaya (4,884 m, ~550 hPa).
const MIN_SURFACE_PRESSURE_HPA = 400;
const MAX_SURFACE_PRESSURE_HPA = 1100;
const MIN_TEMPERATURE_C = -40;
const MAX_TEMPERATURE_C = 60;

const PRECIPITATION_TO_MM: Record<string, number> = { mm: 1, inch: 25.4 };
const PRESSURE_TO_HPA: Record<string, number> = { hPa: 1, kPa: 10, Pa: 0.01 };

export interface NormalizedHourlySample {
  validTime: Date;
  gridElevationM: number | null;
  precipitationMm: number | null;
  windSpeed10mKmh: number | null;
  windFrom10mDeg: number | null;
  windSpeed850hPaKmh: number | null;
  windFrom850hPaDeg: number | null;
  windSpeed700hPaKmh: number | null;
  windFrom700hPaDeg: number | null;
  temperatureC: number | null;
  relativeHumidityPct: number | null;
  surfacePressureHpa: number | null;
  soilMoisture9To27cmM3m3: number | null;
  qualityFlags: string[];
}

export interface OpenMeteoHourlyResponse {
  elevation?: number;
  hourly_units?: Record<string, string>;
  hourly?: Record<string, Array<number | null> | string[] | undefined> & {
    time: string[];
  };
}

export interface NormalizeResult {
  samples: NormalizedHourlySample[];
  /** Hours after `now` — forecasts, not stored by Milestone 1. */
  futureHoursDropped: number;
  duplicateHoursDropped: number;
  unparseableTimesDropped: number;
  /** Variables whose unit was missing/unrecognized (whole series nulled). */
  unrecognizedUnits: string[];
}

/** Open-Meteo GMT times have no offset ("2026-10-06T13:00"). */
export function parseUtcTime(time: string): Date | null {
  const date = new Date(`${time}${time.endsWith('Z') ? '' : 'Z'}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unitFactor(
  units: Record<string, string>,
  variable: string,
  table: Record<string, number>,
): number | null {
  const unit = units[variable];
  return unit !== undefined && table[unit] !== undefined ? table[unit] : null;
}

export function normalizeOpenMeteoHourly(
  data: OpenMeteoHourlyResponse,
  now: Date,
): NormalizeResult {
  const result: NormalizeResult = {
    samples: [],
    futureHoursDropped: 0,
    duplicateHoursDropped: 0,
    unparseableTimesDropped: 0,
    unrecognizedUnits: [],
  };
  const hourly = data.hourly;
  if (!hourly?.time?.length) return result;
  const units = data.hourly_units ?? {};

  const factors = {
    precipitation: unitFactor(units, 'precipitation', PRECIPITATION_TO_MM),
    wind_speed_10m: unitFactor(units, 'wind_speed_10m', SPEED_TO_KMH),
    wind_speed_850hPa: unitFactor(units, 'wind_speed_850hPa', SPEED_TO_KMH),
    wind_speed_700hPa: unitFactor(units, 'wind_speed_700hPa', SPEED_TO_KMH),
    surface_pressure: unitFactor(units, 'surface_pressure', PRESSURE_TO_HPA),
  };
  const expectUnit = (variable: string, expected: string) =>
    units[variable] === expected;
  const unitOk: Record<string, boolean> = {
    precipitation: factors.precipitation !== null,
    wind_speed_10m: factors.wind_speed_10m !== null,
    wind_speed_850hPa: factors.wind_speed_850hPa !== null,
    wind_speed_700hPa: factors.wind_speed_700hPa !== null,
    wind_direction_10m: expectUnit('wind_direction_10m', '°'),
    wind_direction_850hPa: expectUnit('wind_direction_850hPa', '°'),
    wind_direction_700hPa: expectUnit('wind_direction_700hPa', '°'),
    // °F is converted below; anything else is rejected.
    temperature_2m:
      expectUnit('temperature_2m', '°C') || expectUnit('temperature_2m', '°F'),
    relative_humidity_2m: expectUnit('relative_humidity_2m', '%'),
    surface_pressure: factors.surface_pressure !== null,
    soil_moisture_9_to_27cm: expectUnit('soil_moisture_9_to_27cm', 'm³/m³'),
  };
  result.unrecognizedUnits = OPEN_METEO_HOURLY_VARIABLES.filter(
    (variable) => !unitOk[variable],
  );

  const series = (name: string) => (hourly[name] ?? []) as Array<number | null>;
  const gridElevationM = finiteIn(data.elevation, -500, 9000);
  const seen = new Set<number>();

  hourly.time.forEach((rawTime, i) => {
    const validTime = parseUtcTime(rawTime);
    if (!validTime) {
      result.unparseableTimesDropped += 1;
      return;
    }
    if (validTime.getTime() > now.getTime()) {
      result.futureHoursDropped += 1;
      return;
    }
    if (seen.has(validTime.getTime())) {
      result.duplicateHoursDropped += 1;
      return;
    }
    seen.add(validTime.getTime());

    const flags: string[] = [];
    // Reads one value: null + flag when the unit is unknown, the value is
    // missing, or it falls outside [min, max] (after unit conversion).
    const read = (
      variable: string,
      min: number,
      max: number,
      convert: (raw: number) => number = (raw) => raw,
    ): number | null => {
      if (!unitOk[variable]) {
        flags.push(`${variable}:unit_unrecognized`);
        return null;
      }
      const raw = series(variable)[i];
      if (raw === null || raw === undefined) {
        flags.push(`${variable}:missing`);
        return null;
      }
      const value =
        typeof raw === 'number' && Number.isFinite(raw) ? convert(raw) : NaN;
      const checked = finiteIn(value, min, max);
      if (checked === null) flags.push(`${variable}:out_of_range`);
      return checked;
    };
    const direction = (variable: string) => {
      const deg = read(variable, 0, 360);
      return deg === null ? null : normalizeDirectionDeg(deg);
    };
    const scale = (factor: number | null) => (raw: number) =>
      raw * (factor ?? NaN);

    const temperatureIsF = units.temperature_2m === '°F';
    result.samples.push({
      validTime,
      gridElevationM,
      precipitationMm: read(
        'precipitation',
        0,
        MAX_HOURLY_PRECIPITATION_MM,
        scale(factors.precipitation),
      ),
      windSpeed10mKmh: read(
        'wind_speed_10m',
        0,
        MAX_WIND_KMH,
        scale(factors.wind_speed_10m),
      ),
      windFrom10mDeg: direction('wind_direction_10m'),
      windSpeed850hPaKmh: read(
        'wind_speed_850hPa',
        0,
        MAX_WIND_KMH,
        scale(factors.wind_speed_850hPa),
      ),
      windFrom850hPaDeg: direction('wind_direction_850hPa'),
      windSpeed700hPaKmh: read(
        'wind_speed_700hPa',
        0,
        MAX_WIND_KMH,
        scale(factors.wind_speed_700hPa),
      ),
      windFrom700hPaDeg: direction('wind_direction_700hPa'),
      temperatureC: read(
        'temperature_2m',
        MIN_TEMPERATURE_C,
        MAX_TEMPERATURE_C,
        (raw) => (temperatureIsF ? ((raw - 32) * 5) / 9 : raw),
      ),
      relativeHumidityPct: read('relative_humidity_2m', 0, 100),
      surfacePressureHpa: read(
        'surface_pressure',
        MIN_SURFACE_PRESSURE_HPA,
        MAX_SURFACE_PRESSURE_HPA,
        scale(factors.surface_pressure),
      ),
      soilMoisture9To27cmM3m3: read('soil_moisture_9_to_27cm', 0, 1),
      qualityFlags: flags,
    });
  });

  return result;
}
