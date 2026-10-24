import { NotFoundException } from '@nestjs/common';
import { RainfallLandslideRiskService } from './rainfall-landslide-risk.service';

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
    soil_moisture_9_27cm_m3m3: null,
  }));
}

function build(opts: {
  samples?: unknown[];
  profiles?: Map<string, unknown>;
  engine?: jest.Mock;
}) {
  const districtQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'orderBy']) {
    districtQb[m] = jest.fn(() => districtQb);
  }
  districtQb.getRawMany = jest.fn().mockResolvedValue([
    { id: 'hill', latitude: '-7.2', longitude: '109.9' },
    { id: 'dry', latitude: '-8.6', longitude: '116.1' },
  ]);
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
        modelVersion: 'landslide-rule-baseline-v0.1',
        issuedAt: NOW.toISOString(),
        calibrated: false,
        parameters: { lowerIdAlpha: 2.2 },
        factorBases: { slope: 'Permen PU' },
        missingInputs: ['REQUIRED DATA: x'],
        points: request.points.map((p) => ({ id: p.id, level: 'LOW' })),
      }),
    );
  const service = new RainfallLandslideRiskService(
    { predictRainLandslideRisk: engine } as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
    { load: jest.fn().mockResolvedValue(opts.profiles ?? new Map()) } as never,
    { createQueryBuilder: jest.fn(() => districtQb) } as never,
    { query: jest.fn().mockResolvedValue(opts.samples ?? []) } as never,
    runRepository as never,
  );
  return { service, engine, runRepository };
}

describe('RainfallLandslideRiskService', () => {
  it('assembles rainfall and terrain per district and persists the run', async () => {
    const { service, engine } = build({
      samples: [
        ...sampleRows('hill', 'gsmap_gauge_now', 24, 2),
        ...sampleRows('hill', 'open-meteo', 80, 1),
      ],
      profiles: new Map([
        [
          'hill',
          {
            source: 'open-meteo-elevation',
            dem: 'Copernicus GLO-90',
            slopeSamplesDeg: [10, 20, 30],
          },
        ],
      ]),
    });
    const run = await service.run('manual', NOW);

    expect(run?.status).toBe('completed');
    expect(run?.modelVersion).toBe('landslide-rule-baseline-v0.1');
    expect(run?.dataValidTime).toEqual(LATEST);
    expect(run?.parameters).toEqual(
      expect.objectContaining({ lowerIdAlpha: 2.2, calibrated: false }),
    );
    const request = engine.mock.calls[0][0];
    const hill = request.points.find((p: { id: string }) => p.id === 'hill');
    expect(hill.rainfall.accumulationsMm['24']).toBe(48);
    expect(hill.antecedent.totalMm72Hours).toBe(72);
    expect(hill.terrain).toEqual({
      source: 'open-meteo-elevation',
      dem: 'Copernicus GLO-90',
      slopeSamplesDeg: [10, 20, 30],
    });
    expect(request.points.find((p: { id: string }) => p.id === 'dry')).toEqual({
      id: 'dry',
    });
    expect(run?.warnings.join(' ')).toMatch(/DEM slope sampled for 1 of 2/);
    expect(run?.inputSummary).toEqual(
      expect.objectContaining({
        terrain: expect.objectContaining({
          districtsProfiled: 1,
          districtsWithSlope: 1,
        }),
        missingInputs: ['REQUIRED DATA: x'],
      }),
    );
  });

  it('refuses with no rainfall at all', async () => {
    const { service, engine } = build({});
    const run = await service.run('scheduled', NOW);
    expect(run?.status).toBe('insufficient_data');
    expect(engine).not.toHaveBeenCalled();
  });

  it('records engine failures', async () => {
    const { service } = build({
      samples: sampleRows('hill', 'gsmap_gauge_now', 24, 1),
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
    await expect(service.latest('a')).resolves.toEqual({
      id: 'r',
      results: [{ id: 'a' }],
    });
    expect(runRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hazard: 'landslide' } }),
    );
  });
});
