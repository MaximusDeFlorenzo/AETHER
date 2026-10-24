import { of, throwError } from 'rxjs';
import {
  OpenMeteoClient,
  sumTrailing24hPrecipitationMm,
} from './open-meteo.client';

// 26 hourly UTC stamps, 2026-10-05T12:00 → 2026-10-06T13:00 — the shape
// Open-Meteo returns for past_hours=25&forecast_hours=1 at 13:09 UTC.
function hourlyTimes(): string[] {
  const start = Date.UTC(2026, 9, 5, 12);
  return Array.from({ length: 26 }, (_, i) =>
    new Date(start + i * 3_600_000).toISOString().slice(0, 16),
  );
}

const NOW = new Date('2026-10-06T13:09:00Z');

describe('sumTrailing24hPrecipitationMm', () => {
  it('sums exactly the 24 completed hours ending at now, ignoring older and future hours', () => {
    const times = hourlyTimes();
    // 1 mm in every hour, plus big values outside the window: 12:00 on
    // Oct 5 (covers 11:00-12:00, older than now-24h) and nothing after now.
    const precipitation = times.map((t) =>
      t === '2026-10-05T12:00' ? 100 : 1,
    );

    expect(sumTrailing24hPrecipitationMm(times, precipitation, NOW)).toBe(24);
  });

  it('is not the previous calendar day in Asia/Jakarta (the old behaviour)', () => {
    const times = hourlyTimes();
    // Rain only in the most recent hour — would have been invisible when
    // summing "yesterday" instead of the trailing window.
    const precipitation = times.map((t) => (t === '2026-10-06T13:00' ? 42 : 0));

    expect(sumTrailing24hPrecipitationMm(times, precipitation, NOW)).toBe(42);
  });

  it('returns null instead of undercounting when an hour is missing', () => {
    const times = hourlyTimes();
    const precipitation: Array<number | null> = times.map(() => 1);
    precipitation[20] = null;

    expect(sumTrailing24hPrecipitationMm(times, precipitation, NOW)).toBeNull();
  });

  it('returns null when the response does not cover the whole window', () => {
    const times = hourlyTimes().slice(5);
    expect(
      sumTrailing24hPrecipitationMm(
        times,
        times.map(() => 1),
        NOW,
      ),
    ).toBeNull();
  });

  it('rejects impossible negative values', () => {
    const times = hourlyTimes();
    const precipitation = times.map(() => 1);
    precipitation[25] = -3;

    expect(sumTrailing24hPrecipitationMm(times, precipitation, NOW)).toBeNull();
  });
});

describe('OpenMeteoClient.getLast24hRainfallMm', () => {
  function buildClient() {
    const http = { get: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    return { client: new OpenMeteoClient(http as any, config as any), http };
  }

  it('requests a UTC trailing window and sums it', async () => {
    const { client, http } = buildClient();
    const times = hourlyTimes();
    http.get.mockReturnValue(
      of({
        data: { hourly: { time: times, precipitation: times.map(() => 2) } },
      }),
    );

    await expect(client.getLast24hRainfallMm(106.8, -6.2, NOW)).resolves.toBe(
      48,
    );
    expect(http.get.mock.calls[0][1].params).toEqual(
      expect.objectContaining({
        past_hours: 25,
        forecast_hours: 1,
        timezone: 'GMT',
      }),
    );
  });

  it('returns null rather than throwing when Open-Meteo is unreachable', async () => {
    const { client, http } = buildClient();
    http.get.mockReturnValue(throwError(() => new Error('timeout')));

    await expect(
      client.getLast24hRainfallMm(106.8, -6.2, NOW),
    ).resolves.toBeNull();
  });
});
