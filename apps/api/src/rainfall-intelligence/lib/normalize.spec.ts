import {
  normalizeOpenMeteoHourly,
  OPEN_METEO_HOURLY_VARIABLES,
  parseUtcTime,
  type OpenMeteoHourlyResponse,
} from './normalize';

const UNITS: Record<string, string> = {
  time: 'iso8601',
  precipitation: 'mm',
  wind_speed_10m: 'km/h',
  wind_direction_10m: '°',
  wind_speed_850hPa: 'km/h',
  wind_direction_850hPa: '°',
  wind_speed_700hPa: 'km/h',
  wind_direction_700hPa: '°',
  temperature_2m: '°C',
  relative_humidity_2m: '%',
  surface_pressure: 'hPa',
  soil_moisture_9_to_27cm: 'm³/m³',
};

// Shape copied from a real response (Jakarta, 2026-10-06, timezone=GMT).
function response(
  times: string[],
  overrides: Record<string, Array<number | null>> = {},
  units: Record<string, string> = UNITS,
): OpenMeteoHourlyResponse {
  const base: Record<string, number> = {
    precipitation: 0.4,
    wind_speed_10m: 11.9,
    wind_direction_10m: 29,
    wind_speed_850hPa: 18.1,
    wind_direction_850hPa: 170,
    wind_speed_700hPa: 15.5,
    wind_direction_700hPa: 178,
    temperature_2m: 32.8,
    relative_humidity_2m: 51,
    surface_pressure: 1007.9,
    soil_moisture_9_to_27cm: 0.242,
  };
  const hourly: Record<string, Array<number | null>> = {};
  for (const variable of OPEN_METEO_HOURLY_VARIABLES) {
    hourly[variable] = overrides[variable] ?? times.map(() => base[variable]);
  }
  return {
    elevation: 15,
    hourly_units: units,
    hourly: { time: times, ...hourly },
  };
}

const NOW = new Date('2026-10-06T13:09:00Z');

describe('parseUtcTime', () => {
  it('reads offset-less Open-Meteo GMT times as UTC, not local time', () => {
    expect(parseUtcTime('2026-10-06T13:00')?.toISOString()).toBe(
      '2026-10-06T13:00:00.000Z',
    );
    expect(parseUtcTime('2026-10-06T13:00Z')?.toISOString()).toBe(
      '2026-10-06T13:00:00.000Z',
    );
    expect(parseUtcTime('garbage')).toBeNull();
  });
});

describe('normalizeOpenMeteoHourly', () => {
  it('keeps past hours, drops future hours, converts nothing when units are canonical', () => {
    const result = normalizeOpenMeteoHourly(
      response(['2026-10-06T12:00', '2026-10-06T13:00', '2026-10-06T14:00']),
      NOW,
    );
    expect(result.samples).toHaveLength(2);
    expect(result.futureHoursDropped).toBe(1);
    expect(result.samples[1]).toEqual(
      expect.objectContaining({
        validTime: new Date('2026-10-06T13:00:00Z'),
        precipitationMm: 0.4,
        windFrom700hPaDeg: 178,
        surfacePressureHpa: 1007.9,
        gridElevationM: 15,
        qualityFlags: [],
      }),
    );
  });

  it('converts non-canonical units (m/s, inch, °F, kPa)', () => {
    const units = {
      ...UNITS,
      wind_speed_10m: 'm/s',
      precipitation: 'inch',
      temperature_2m: '°F',
      surface_pressure: 'kPa',
    };
    const [sample] = normalizeOpenMeteoHourly(
      response(
        ['2026-10-06T13:00'],
        {
          wind_speed_10m: [10],
          precipitation: [1],
          temperature_2m: [86],
          surface_pressure: [100.8],
        },
        units,
      ),
      NOW,
    ).samples;
    expect(sample.windSpeed10mKmh).toBeCloseTo(36);
    expect(sample.precipitationMm).toBeCloseTo(25.4);
    expect(sample.temperatureC).toBeCloseTo(30);
    expect(sample.surfacePressureHpa).toBeCloseTo(1008);
  });

  it('nulls a whole variable with an unrecognized unit instead of guessing', () => {
    const result = normalizeOpenMeteoHourly(
      response(['2026-10-06T13:00'], {}, { ...UNITS, precipitation: 'cm' }),
      NOW,
    );
    expect(result.unrecognizedUnits).toEqual(['precipitation']);
    expect(result.samples[0].precipitationMm).toBeNull();
    expect(result.samples[0].qualityFlags).toContain(
      'precipitation:unit_unrecognized',
    );
  });

  it('rejects impossible values and flags missing ones', () => {
    const [sample] = normalizeOpenMeteoHourly(
      response(['2026-10-06T13:00'], {
        precipitation: [-1],
        relative_humidity_2m: [140],
        surface_pressure: [null],
        wind_direction_10m: [400],
      }),
      NOW,
    ).samples;
    expect(sample.precipitationMm).toBeNull();
    expect(sample.relativeHumidityPct).toBeNull();
    expect(sample.surfacePressureHpa).toBeNull();
    expect(sample.windFrom10mDeg).toBeNull();
    expect(sample.qualityFlags).toEqual(
      expect.arrayContaining([
        'precipitation:out_of_range',
        'relative_humidity_2m:out_of_range',
        'surface_pressure:missing',
        'wind_direction_10m:out_of_range',
      ]),
    );
  });

  it('normalizes a 360° direction to 0°', () => {
    const [sample] = normalizeOpenMeteoHourly(
      response(['2026-10-06T13:00'], { wind_direction_10m: [360] }),
      NOW,
    ).samples;
    expect(sample.windFrom10mDeg).toBe(0);
  });

  it('drops duplicate and unparseable timestamps', () => {
    const result = normalizeOpenMeteoHourly(
      response(['2026-10-06T12:00', '2026-10-06T12:00', 'bad']),
      NOW,
    );
    expect(result.samples).toHaveLength(1);
    expect(result.duplicateHoursDropped).toBe(1);
    expect(result.unparseableTimesDropped).toBe(1);
  });

  it('returns nothing for a response without an hourly block', () => {
    expect(normalizeOpenMeteoHourly({}, NOW).samples).toEqual([]);
  });
});
