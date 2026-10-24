import {
  accumulate,
  buildRainfallFeatures,
  classifyFreshness,
  missingHours,
  summarizeDataQuality,
  type HourlyValues,
} from './features';

const HOUR_MS = 3_600_000;
const END = new Date('2026-10-06T12:00:00Z');
const THREE_HOURS_MS = 3 * HOUR_MS;

function sample(
  hoursBeforeEnd: number,
  overrides: Partial<HourlyValues> = {},
): HourlyValues {
  return {
    validTime: new Date(END.getTime() - hoursBeforeEnd * HOUR_MS),
    precipitationMm: 1,
    windSpeed10mKmh: 10,
    windFrom10mDeg: 90,
    windSpeed850hPaKmh: 20,
    windFrom850hPaDeg: 180,
    windSpeed700hPaKmh: 30,
    windFrom700hPaDeg: 200,
    temperatureC: 28,
    relativeHumidityPct: 80,
    surfacePressureHpa: 1008,
    soilMoisture9To27cmM3m3: 0.3,
    qualityFlags: [],
    ...overrides,
  };
}

/** `count` consecutive hours ending at END. */
function series(
  count: number,
  build: (h: number) => Partial<HourlyValues> = () => ({}),
): HourlyValues[] {
  return Array.from({ length: count }, (_, i) =>
    sample(count - 1 - i, build(count - 1 - i)),
  );
}

describe('accumulate', () => {
  it('sums exactly the hours in the window ending at `end`', () => {
    const samples = series(30);
    expect(accumulate(samples, END, 1)).toEqual(
      expect.objectContaining({ totalMm: 1, complete: true }),
    );
    expect(accumulate(samples, END, 24)).toEqual(
      expect.objectContaining({
        totalMm: 24,
        hoursAvailable: 24,
        hoursExpected: 24,
        complete: true,
      }),
    );
  });

  it('does not report a total for a window with a gap', () => {
    const samples = series(24).filter((_, i) => i !== 5);
    const result = accumulate(samples, END, 24);
    expect(result.complete).toBe(false);
    expect(result.totalMm).toBeNull();
    expect(result.availableMm).toBe(23);
    expect(result.hoursAvailable).toBe(23);
  });

  it('treats a rejected (null) hour as missing, not as zero rain', () => {
    const samples = series(3, (h) =>
      h === 1 ? { precipitationMm: null } : {},
    );
    expect(accumulate(samples, END, 3).complete).toBe(false);
  });

  it('counts a duplicated hour once', () => {
    const samples = [...series(3), sample(0, { precipitationMm: 50 })];
    expect(accumulate(samples, END, 3).totalMm).toBe(3);
  });
});

describe('missingHours', () => {
  it('lists the missing hour timestamps', () => {
    const withGap = series(6).filter((_, i) => i !== 2);
    expect(missingHours(withGap, END, 6)).toEqual([
      new Date(END.getTime() - 3 * HOUR_MS).toISOString(),
    ]);
  });
});

describe('classifyFreshness', () => {
  it('is relative to the ingestion interval', () => {
    expect(classifyFreshness(30, THREE_HOURS_MS)).toBe('fresh');
    expect(classifyFreshness(240, THREE_HOURS_MS)).toBe('fresh');
    expect(classifyFreshness(241, THREE_HOURS_MS)).toBe('aging');
    expect(classifyFreshness(420, THREE_HOURS_MS)).toBe('aging');
    expect(classifyFreshness(421, THREE_HOURS_MS)).toBe('stale');
  });
});

describe('buildRainfallFeatures', () => {
  it('builds intensity, change and pressure tendency from complete data', () => {
    const samples = series(24, (h) => ({
      precipitationMm: h < 3 ? 5 : 1,
      surfacePressureHpa: 1008 - (h === 0 ? 2 : 0),
    }));
    const features = buildRainfallFeatures(samples, END);
    expect(features.asOf).toBe(END.toISOString());
    expect(features.intensity).toEqual({
      latestHourMm: 5,
      maxHourly3hMm: 5,
      maxHourly24hMm: 5,
      change3hMm: 12,
    });
    expect(features.atmosphere.pressureTendency3hHpa).toBe(-2);
    expect(
      features.accumulations.find((a) => a.windowHours === 168)?.complete,
    ).toBe(false);
  });

  it('reports wind per level with circular encodings and toward-direction', () => {
    const features = buildRainfallFeatures(series(3), END);
    const surface = features.wind.find((w) => w.level === '10m');
    const steering = features.wind.find((w) => w.level === '700hPa');
    expect(surface?.latest).toEqual(
      expect.objectContaining({
        fromDeg: 90,
        towardDeg: 270,
        compassFrom: 'E',
      }),
    );
    expect(surface?.latest?.sin).toBeCloseTo(1);
    expect(surface?.latest?.cos).toBeCloseTo(0);
    // Surface and steering-level winds are kept separate — they often
    // differ by a lot, and neither is assumed to be the rain's motion.
    expect(steering?.latest?.fromDeg).toBe(200);
    expect(steering?.mean3h?.hours).toBe(3);
    expect(steering?.mean3h?.steadiness).toBeCloseTo(1);
  });

  it('leaves change null when an earlier window is incomplete', () => {
    const features = buildRainfallFeatures(series(4), END);
    expect(features.intensity.change3hMm).toBeNull();
  });
});

describe('summarizeDataQuality', () => {
  it('reports age, freshness, gaps and flag counts', () => {
    const samples = series(24, (h) =>
      h === 0 ? { qualityFlags: ['precipitation:out_of_range'] } : {},
    ).filter((_, i) => i !== 10);
    const quality = summarizeDataQuality(
      samples,
      new Date(END.getTime() + 8 * HOUR_MS),
      THREE_HOURS_MS,
    );
    expect(quality.latestValidTime).toBe(END.toISOString());
    expect(quality.dataAgeMinutes).toBe(480);
    expect(quality.freshness).toBe('stale');
    expect(quality.missingHours24h).toHaveLength(1);
    expect(quality.flags24h).toEqual({ 'precipitation:out_of_range': 1 });
  });

  it('is stale with no data at all', () => {
    expect(summarizeDataQuality([], END, THREE_HOURS_MS)).toEqual(
      expect.objectContaining({ latestValidTime: null, freshness: 'stale' }),
    );
  });
});
