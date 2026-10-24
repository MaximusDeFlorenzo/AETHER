import { parseOpenMeteoAtmosphere } from './open-meteo-atmosphere.provider';
import { parseOverpassPlaces } from './settlements.provider';
import { isTransient, withRetry } from './retry';

const point = { latitude: -2.2, longitude: 113.9 };
const retrievedAt = new Date('2026-09-20T06:00:00Z');

function response(
  overrides: Record<string, unknown> = {},
  units: Record<string, string> = {},
) {
  return {
    latitude: -2.21,
    longitude: 113.92,
    elevation: 40,
    hourly_units: {
      wind_speed_10m: 'km/h',
      wind_speed_925hPa: 'km/h',
      ...units,
    },
    hourly: {
      time: ['2026-09-20T05:00', '2026-09-20T06:00'],
      wind_speed_10m: [10, 12],
      wind_direction_10m: [90, 95],
      temperature_2m: [31, 32],
      relative_humidity_2m: [60, 55],
      precipitation: [0, 0.2],
      boundary_layer_height: [800, 950],
      wind_speed_925hPa: [20, 21],
      wind_direction_925hPa: [100, 105],
      geopotential_height_925hPa: [810, 812],
      ...overrides,
    },
  };
}

describe('parseOpenMeteoAtmosphere', () => {
  it('normalizes timestamps to UTC and converts geopotential height to AGL', () => {
    const series = parseOpenMeteoAtmosphere(
      response() as never,
      point,
      retrievedAt,
    )!;
    expect(series.hours[0].time).toBe('2026-09-20T05:00:00.000Z');
    expect(series.hours[0].levels).toEqual([
      { heightAglM: 10, windSpeedKmh: 10, windFromDeg: 90 },
      { heightAglM: 770, windSpeedKmh: 20, windFromDeg: 100 },
    ]);
    expect(series.retrievedAt).toBe(retrievedAt.toISOString());
    expect(series.latitude).toBe(-2.2); // requested point, not model grid cell
  });

  it('converts m/s and knots to km/h using the provider-declared unit', () => {
    const ms = parseOpenMeteoAtmosphere(
      response({}, { wind_speed_10m: 'm/s' }) as never,
      point,
      retrievedAt,
    )!;
    expect(ms.hours[0].windSpeed10mKmh).toBeCloseTo(36);
    const kn = parseOpenMeteoAtmosphere(
      response({}, { wind_speed_925hPa: 'kn' }) as never,
      point,
      retrievedAt,
    )!;
    expect(kn.hours[0].levels[1].windSpeedKmh).toBeCloseTo(37.04);
  });

  it('rejects unknown wind units rather than guessing', () => {
    expect(
      parseOpenMeteoAtmosphere(
        response({}, { wind_speed_10m: 'furlongs' }) as never,
        point,
        retrievedAt,
      ),
    ).toBeNull();
  });

  it('drops hours with invalid 10 m wind and nulls invalid optional values', () => {
    const series = parseOpenMeteoAtmosphere(
      response({
        wind_speed_10m: [null, 12],
        relative_humidity_2m: [60, 140],
        boundary_layer_height: [800, -5],
      }) as never,
      point,
      retrievedAt,
    )!;
    expect(series.hours).toHaveLength(1);
    expect(series.hours[0].relativeHumidityPct).toBeNull();
    expect(series.hours[0].boundaryLayerHeightM).toBeNull();
  });

  it('drops pressure levels that are underground at this point', () => {
    const series = parseOpenMeteoAtmosphere(
      { ...response(), elevation: 790 } as never,
      point,
      retrievedAt,
    )!;
    expect(series.hours[0].levels).toHaveLength(1);
  });

  it('returns null without an hourly block', () => {
    expect(
      parseOpenMeteoAtmosphere(
        { latitude: 0, longitude: 0 } as never,
        point,
        retrievedAt,
      ),
    ).toBeNull();
  });
});

describe('parseOverpassPlaces', () => {
  it('keeps named, valid nodes only', () => {
    const places = parseOverpassPlaces([
      {
        type: 'node',
        id: 1,
        lat: -2.2,
        lon: 113.9,
        tags: { name: 'Palangka Raya', place: 'city' },
      },
      {
        type: 'node',
        id: 2,
        lat: -2.3,
        lon: 113.8,
        tags: { place: 'village' },
      },
      {
        type: 'node',
        id: 3,
        lat: 99,
        lon: 113.8,
        tags: { name: 'Bad', place: 'village' },
      },
      { type: 'way', id: 4, tags: { name: 'Way', place: 'town' } },
    ]);
    expect(places).toEqual([
      expect.objectContaining({
        id: 'osm-node-1',
        name: 'Palangka Raya',
        placeType: 'city',
        source: 'openstreetmap',
      }),
    ]);
  });
});

describe('withRetry', () => {
  it('retries transient failures then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors', async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 400 } });
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toEqual({
      response: { status: 400 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('classifies transient errors', () => {
    expect(isTransient({ response: { status: 429 } })).toBe(true);
    expect(isTransient(new Error('timeout'))).toBe(true);
    expect(isTransient({ response: { status: 404 } })).toBe(false);
  });
});
