import { ispuCategory, pickStation, toAirQuality } from './air-quality.service';

describe('ispuCategory', () => {
  it.each([
    [10, 'baik'],
    [15.5, 'baik'],
    [40, 'sedang'],
    [100, 'tidak_sehat'],
    [200, 'sangat_tidak_sehat'],
    [400, 'berbahaya'],
  ])('PM2.5 %p µg/m³ → %s', (pm25, category) => {
    expect(ispuCategory(pm25)).toBe(category);
  });
});

describe('toAirQuality', () => {
  it('normalizes times to UTC and classifies the current PM2.5', () => {
    const result = toAirQuality({
      current: {
        time: '2026-10-23T13:00',
        pm2_5: 159.7,
        pm10: 169.5,
        carbon_monoxide: 2753,
        carbon_dioxide: 515,
        us_aqi: 286,
      },
      hourly: { time: ['2026-10-23T13:00'], pm2_5: [159.7] },
    });
    expect(result).toMatchObject({
      observedAt: '2026-10-23T13:00:00.000Z',
      pm25: 159.7,
      carbonDioxidePpm: 515,
      ispu: 'sangat_tidak_sehat',
      hourly: [{ time: '2026-10-23T13:00:00.000Z', pm25: 159.7 }],
    });
  });

  it('returns null without current data', () => {
    expect(toAirQuality({})).toBeNull();
  });
});

describe('pickStation', () => {
  const now = new Date('2026-10-23T14:00:00Z').getTime();
  const loc = (
    id: number,
    distance: number,
    last: string,
    opts: { isMonitor?: boolean; isMobile?: boolean; params?: string[] } = {},
  ) => ({
    id,
    name: `S${id}`,
    isMonitor: opts.isMonitor ?? false,
    isMobile: opts.isMobile ?? false,
    distance,
    datetimeLast: { utc: last },
    sensors: (opts.params ?? ['pm25']).map((name, i) => ({
      id: id * 10 + i,
      parameter: { name },
    })),
  });

  it('skips offline, mobile and non-PM2.5 stations', () => {
    expect(
      pickStation(
        [
          loc(1, 1_000, '2016-11-09T16:00:00Z'),
          loc(2, 2_000, '2026-10-23T13:00:00Z', { isMobile: true }),
          loc(3, 3_000, '2026-10-23T13:00:00Z', { params: ['o3'] }),
          loc(4, 9_000, '2026-10-23T13:00:00Z'),
        ],
        now,
      )?.id,
    ).toBe(4);
  });

  it('prefers a reference monitor slightly farther than a sensor', () => {
    expect(
      pickStation(
        [
          loc(1, 2_000, '2026-10-23T13:00:00Z'),
          loc(2, 5_000, '2026-10-23T13:00:00Z', { isMonitor: true }),
        ],
        now,
      )?.id,
    ).toBe(2);
  });

  it('returns null when nothing reported recently', () => {
    expect(
      pickStation([loc(1, 1_000, '2026-10-23T09:00:00Z')], now),
    ).toBeNull();
  });
});
