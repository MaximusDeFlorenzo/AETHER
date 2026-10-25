import { of, throwError } from 'rxjs';
import { PublicWeatherService, toWind } from './public-weather.service';

function openMeteoPoint(windFrom: number) {
  return {
    current: {
      time: '2026-09-29T07:00',
      wind_speed_10m: 14,
      wind_direction_10m: windFrom,
      precipitation: 0,
    },
    hourly: {
      time: ['2026-09-29T08:00'],
      wind_speed_10m: [15],
      wind_direction_10m: [windFrom],
      precipitation: [0],
    },
  };
}

function buildService() {
  const http = { get: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new PublicWeatherService(
    http as any,
    config as any,
    {} as any,
  );
  return { service, http };
}

describe('PublicWeatherService.getWindAt', () => {
  it('fetches every uncached point in one multi-location request, in order', async () => {
    const { service, http } = buildService();
    http.get.mockReturnValue(
      of({ data: [openMeteoPoint(135), openMeteoPoint(90)] }),
    );

    const result = await service.getWindAt([
      { latitude: -1.8, longitude: 110.2 },
      { latitude: -2.2, longitude: 113.9 },
    ]);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0][1].params).toEqual(
      expect.objectContaining({
        latitude: '-1.8,-2.2',
        longitude: '110.2,113.9',
      }),
    );
    expect(result.map((wind) => wind?.windFromDeg)).toEqual([135, 90]);
  });

  it('serves nearby points from cache instead of calling Open-Meteo again', async () => {
    const { service, http } = buildService();
    http.get.mockReturnValue(of({ data: openMeteoPoint(135) }));

    await service.getWindAt([{ latitude: -1.81, longitude: 110.21 }]);
    const again = await service.getWindAt([
      { latitude: -1.83, longitude: 110.24 },
    ]);

    expect(http.get).toHaveBeenCalledTimes(1);
    // The caller still gets its own coordinates back, not the cached ones.
    expect(again[0]).toEqual(
      expect.objectContaining({
        latitude: -1.83,
        longitude: 110.24,
        windFromDeg: 135,
      }),
    );
  });

  it('returns nulls rather than throwing when Open-Meteo is unreachable', async () => {
    const { service, http } = buildService();
    http.get.mockReturnValue(throwError(() => new Error('timeout')));

    await expect(
      service.getWindAt([{ latitude: -1.8, longitude: 110.2 }]),
    ).resolves.toEqual([null]);
  });
});

describe('toWind', () => {
  it('normalizes offset-less Open-Meteo GMT times to explicit UTC ISO strings', () => {
    const wind = toWind(openMeteoPoint(90));

    expect(wind?.observedAt).toBe('2026-09-29T07:00:00.000Z');
    expect(wind?.hourly.map((h) => h.time)).toEqual([
      '2026-09-29T08:00:00.000Z',
    ]);
  });

  it('requests GMT so the normalized times are actually UTC', async () => {
    const { service, http } = buildService();
    http.get.mockReturnValue(of({ data: openMeteoPoint(90) }));

    await service.getWindAt([{ latitude: -1.8, longitude: 110.2 }]);

    expect(http.get.mock.calls[0][1].params.timezone).toBe('GMT');
  });

  it('drops a reading whose current time is unparseable', () => {
    const data = openMeteoPoint(90);
    data.current.time = 'not-a-time';
    expect(toWind(data)).toBeNull();
  });
});

describe('toWind with a local-time (timezone=auto) response', () => {
  it('converts local times to UTC and maps the daily summary', () => {
    const wind = toWind({
      utc_offset_seconds: 7 * 3600,
      current: {
        time: '2026-10-25T12:45',
        wind_speed_10m: 7,
        wind_direction_10m: 200,
        precipitation: 0,
      },
      hourly: {
        time: ['2026-10-25T13:00'],
        wind_speed_10m: [8],
        wind_direction_10m: [210],
        precipitation: [0.4],
      },
      daily: {
        time: ['2026-10-25', '2026-10-26'],
        precipitation_sum: [0.6, 23.1],
        precipitation_probability_max: [35, null],
        weather_code: [51, 63],
      },
    });

    expect(wind?.observedAt).toBe('2026-10-25T05:45:00.000Z');
    expect(wind?.hourly[0].time).toBe('2026-10-25T06:00:00.000Z');
    expect(wind?.daily).toEqual([
      {
        date: '2026-10-25',
        precipitationSumMm: 0.6,
        precipitationProbabilityMax: 35,
        weatherCode: 51,
      },
      {
        date: '2026-10-26',
        precipitationSumMm: 23.1,
        precipitationProbabilityMax: null,
        weatherCode: 63,
      },
    ]);
  });
});
