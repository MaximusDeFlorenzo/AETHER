import { LandslideRainfallTriggerAdapter } from './landslide-rainfall-trigger.adapter';

const HOUR_MS = 3_600_000;
const LATEST = new Date('2026-10-06T14:00:00Z');
const NOW = new Date(LATEST.getTime() + 15 * 60_000);

/** 24 consecutive stored hours ending at LATEST. */
function rows(districtId: string, source: string, mmPerHour: number) {
  return Array.from({ length: 24 }, (_, i) => ({
    district_id: districtId,
    source,
    valid_time: new Date(LATEST.getTime() - (23 - i) * HOUR_MS),
    precipitation_mm: mmPerHour,
  }));
}

function build(
  stored: unknown[],
  terrain: Array<{ district_id: string; slope_samples_deg: number[] }> = [
    // p90 of 10 × 10° + 6 × 30° = 30°
    {
      district_id: 'wet',
      slope_samples_deg: [...new Array(10).fill(10), ...new Array(6).fill(30)],
    },
  ],
) {
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue([
    { id: 'wet', name: 'Kab. Basah', latitude: -7, longitude: 110 },
    { id: 'dry', name: 'Kab. Kering', latitude: -8, longitude: 115 },
  ]);
  const sampleRepository = { query: jest.fn().mockResolvedValue(stored) };
  const terrainRepository = { query: jest.fn().mockResolvedValue(terrain) };
  const adapter = new LandslideRainfallTriggerAdapter(
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    sampleRepository as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
    terrainRepository as never,
  );
  return { adapter, sampleRepository, terrainRepository };
}

describe('LandslideRainfallTriggerAdapter', () => {
  it('triggers from stored satellite rainfall without calling a weather API', async () => {
    const { adapter, sampleRepository, terrainRepository } = build([
      ...rows('wet', 'gsmap_gauge_now', 5), // 120 mm/24 h
      ...rows('wet', 'open-meteo', 1), // model says 24 mm — not used
      ...rows('dry', 'gsmap_gauge_now', 1),
    ]);

    const candidates = await adapter.fetch(NOW);

    expect(sampleRepository.query).toHaveBeenCalledTimes(1);
    expect(candidates).toEqual([
      expect.objectContaining({
        districtId: 'wet',
        rainfallMm: 120,
        rainfallSource: 'gsmap_gauge_now',
        rainfallDataKind: 'satellite_estimate',
        effectiveSlopeDegrees: 30,
        slopeSource: 'dem_p90',
        observedAt: LATEST.toISOString(),
      }),
    ]);
    // Terrain is only read for districts over the threshold.
    expect(terrainRepository.query).toHaveBeenCalledWith(expect.any(String), [
      ['wet'],
    ]);
  });

  it('falls back to stored model rainfall when no satellite data exists', async () => {
    const { adapter } = build(rows('wet', 'open-meteo', 5));
    const [candidate] = await adapter.fetch(NOW);
    expect(candidate).toEqual(
      expect.objectContaining({
        rainfallSource: 'open-meteo',
        rainfallDataKind: 'nwp_model',
      }),
    );
  });

  it('does not trigger on an incomplete 24 h window', async () => {
    const { adapter } = build(
      rows('wet', 'gsmap_gauge_now', 10).filter((_, i) => i !== 0),
    );
    await expect(adapter.fetch(NOW)).resolves.toEqual([]);
  });

  it('records the rainfall source in the normalized event', async () => {
    const { adapter } = build(rows('wet', 'gsmap_gauge_now', 5), []);
    const [candidate] = await adapter.fetch(NOW);
    const event = adapter.normalize(candidate);
    expect(event.externalId).toBe('wet-landslide-2026-10-06');
    expect(event.eventTime).toEqual(LATEST);
    expect(event.rawPayload).toEqual(
      expect.objectContaining({ rainfallSource: 'gsmap_gauge_now' }),
    );
    expect(event.details).toEqual({
      slopeDegrees: 25, // no DEM profile stored yet → documented default
      soilSaturation: 0.8,
      triggeringRainfallMm: 120,
    });
  });
});

describe('LandslideRainfallTriggerAdapter slope', () => {
  it('ignores a profile with too few land samples', async () => {
    const { adapter } = build(rows('wet', 'gsmap_gauge_now', 5), [
      { district_id: 'wet', slope_samples_deg: [40, 40] },
    ]);
    const [candidate] = await adapter.fetch(NOW);
    expect(candidate).toEqual(
      expect.objectContaining({
        effectiveSlopeDegrees: 25,
        slopeSource: 'default',
      }),
    );
  });
});
