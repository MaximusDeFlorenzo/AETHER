import { NotFoundException } from '@nestjs/common';
import { RainfallFloodRiskService } from './rainfall-flood-risk.service';

const HOUR_MS = 3_600_000;
const NOW = new Date('2026-10-07T02:30:00Z');
const LATEST = new Date('2026-10-07T02:00:00Z');

function sampleRows(
  districtId: string,
  source: string,
  hours: number,
  mm: number,
) {
  return Array.from({ length: hours }, (_, i) => ({
    district_id: districtId,
    source,
    valid_time: new Date(LATEST.getTime() - i * HOUR_MS),
    precipitation_mm: mm,
    soil_moisture_9_27cm_m3m3: source === 'open-meteo' ? 0.4 : null,
  }));
}

function build(opts: {
  samples?: unknown[];
  indices?: Map<string, { valueMean: number | null }>;
  gaugeEvents?: unknown[];
  engine?: jest.Mock;
}) {
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue([
    { id: 'jkt', latitude: '-6.2', longitude: '106.8' },
    { id: 'dry', latitude: '-8.6', longitude: '116.1' },
  ]);
  const eventQb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere']) eventQb[m] = jest.fn(() => eventQb);
  eventQb.getMany = jest.fn().mockResolvedValue(opts.gaugeEvents ?? []);
  const runRepository = {
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) =>
      Promise.resolve({ id: 'run1', ...(x as object) }),
    ),
    findOne: jest.fn(),
  };
  const engine =
    opts.engine ??
    jest.fn((request: { points: Array<{ id: string }> }) =>
      Promise.resolve({
        modelVersion: 'flood-rule-baseline-v0.1',
        issuedAt: NOW.toISOString(),
        calibrated: false,
        parameters: { dailyLebatMm: 50 },
        factorBases: { rain_24h: 'BMKG' },
        missingInputs: ['REQUIRED DATA: x'],
        points: request.points.map((p) => ({ id: p.id, level: 'LOW' })),
      }),
    );
  const service = new RainfallFloodRiskService(
    { predictRainFloodRisk: engine } as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
    { load: jest.fn().mockResolvedValue(opts.indices ?? new Map()) } as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    { query: jest.fn().mockResolvedValue(opts.samples ?? []) } as never,
    { createQueryBuilder: jest.fn(() => eventQb) } as never,
    runRepository as never,
  );
  return { service, engine, runRepository };
}

describe('RainfallFloodRiskService', () => {
  it('assembles per-district inputs from stored data and persists the run', async () => {
    const indices = new Map(
      Array.from({ length: 40 }, (_, i) => [
        i === 0 ? 'jkt' : `other${i}`,
        { valueMean: i / 39 },
      ]),
    );
    const { service, engine } = build({
      samples: [
        ...sampleRows('jkt', 'gsmap_gauge_now', 24, 3),
        ...sampleRows('jkt', 'open-meteo', 80, 1),
      ],
      indices,
      gaugeEvents: [
        {
          latitude: -6.21,
          longitude: 106.85,
          eventTime: LATEST,
          locationLabel: 'Manggarai',
          rawPayload: { alertLevel: 'SIAGA III', gaugeName: 'Manggarai' },
        },
        {
          latitude: -6.2,
          longitude: 106.8,
          eventTime: LATEST,
          locationLabel: 'X',
          rawPayload: { alertLevel: 'unknown' },
        },
      ],
    });
    const run = await service.run('manual', NOW);

    expect(run?.status).toBe('completed');
    expect(run?.modelVersion).toBe('flood-rule-baseline-v0.1');
    expect(run?.dataValidTime).toEqual(LATEST);
    expect(run?.parameters).toEqual(
      expect.objectContaining({
        dailyLebatMm: 50,
        calibrated: false,
        factorBases: { rain_24h: 'BMKG' },
      }),
    );
    const request = engine.mock.calls[0][0];
    expect(request.parameters.susceptibilityBreaks).toHaveLength(2);
    const jkt = request.points.find((p: { id: string }) => p.id === 'jkt');
    expect(jkt.rainfall).toEqual(
      expect.objectContaining({
        source: 'gsmap_gauge_now',
        freshness: 'fresh',
        maxHourlyMmLast3Hours: 3,
      }),
    );
    expect(jkt.rainfall.accumulationsMm['24']).toBe(72);
    expect(jkt.antecedent).toEqual(
      expect.objectContaining({ source: 'open-meteo', totalMm72Hours: 72 }),
    );
    expect(jkt.soilMoisture.volumetricFraction).toBe(0.4);
    expect(jkt.susceptibility).toEqual({
      source: 'bnpb_inarisk',
      floodHazardIndex: 0,
    });
    // Only the gauge with an official Siaga label counts.
    expect(jkt.gauge).toEqual(
      expect.objectContaining({ name: 'Manggarai', alertLevel: 3 }),
    );
    const dry = request.points.find((p: { id: string }) => p.id === 'dry');
    expect(dry).toEqual({ id: 'dry' });
    expect(run?.inputSummary).toEqual(
      expect.objectContaining({
        rainfallSource: { gsmap_gauge_now: 1, none: 1 },
        missingInputs: ['REQUIRED DATA: x'],
      }),
    );
  });

  it('warns when susceptibility is unknown and refuses with no rainfall at all', async () => {
    const { service, engine } = build({});
    const run = await service.run('scheduled', NOW);
    expect(run?.status).toBe('insufficient_data');
    expect(run?.warnings.join(' ')).toMatch(/InaRISK/);
    expect(run?.warnings.join(' ')).toMatch(/No stored rainfall/);
    expect(engine).not.toHaveBeenCalled();
  });

  it('records engine failures', async () => {
    const { service } = build({
      samples: sampleRows('jkt', 'gsmap_gauge_now', 24, 1),
      engine: jest.fn().mockRejectedValue(new Error('engine down')),
    });
    const run = await service.run('manual', NOW);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('engine down');
  });

  it('latest() filters by district and 404s when missing', async () => {
    const { service, runRepository } = build({});
    runRepository.findOne.mockResolvedValueOnce(null);
    await expect(service.latest()).rejects.toBeInstanceOf(NotFoundException);
    runRepository.findOne.mockResolvedValue({
      id: 'r',
      results: [{ id: 'a' }, { id: 'b' }],
    });
    await expect(service.latest('b')).resolves.toEqual({
      id: 'r',
      results: [{ id: 'b' }],
    });
    await expect(service.latest('zzz')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
