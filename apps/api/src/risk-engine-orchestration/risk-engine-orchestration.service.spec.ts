import { EventEmitter2 } from '@nestjs/event-emitter';
import { RiskEngineOrchestrationService } from './risk-engine-orchestration.service';
import { HazardType, RiskAssessmentStatus } from '../common/enums/domain.enum';

/** Chainable mock matching the `.createQueryBuilder('d').innerJoin(...)
 * .where(...).select(...).addSelect(...).getRawOne()` shape
 * `buildBaselineHazardEventInput` uses against each `*_details` repository. */
function averageQueryBuilderMock(rawResult: Record<string, string | null>) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['innerJoin', 'where', 'select', 'addSelect']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawOne = jest.fn().mockResolvedValue(rawResult);
  return qb;
}

function makeDetailsRepo(rawResult: Record<string, string | null>) {
  return {
    createQueryBuilder: jest
      .fn()
      .mockReturnValue(averageQueryBuilderMock(rawResult)),
    findOne: jest.fn(),
  };
}

describe('RiskEngineOrchestrationService', () => {
  const districtId = 'district-1';
  const district = {
    id: districtId,
    name: 'Kabupaten Test',
    province: { id: 'province-1' },
  };

  let earthquakeDetailsRepository: ReturnType<typeof makeDetailsRepo>;
  let landslideDetailsRepository: ReturnType<typeof makeDetailsRepo>;
  let floodDetailsRepository: ReturnType<typeof makeDetailsRepo>;
  let wildfireDetailsRepository: ReturnType<typeof makeDetailsRepo>;
  let riskAssessmentRepository: {
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let decisionRecommendationRepository: { create: jest.Mock; save: jest.Mock };
  let riskEngineClient: {
    predictRisk: jest.Mock;
    calculatePriority: jest.Mock;
    generateRecommendation: jest.Mock;
  };
  let geoService: {
    getDistrictCentroid: jest.Mock;
    findDistrictOrThrow: jest.Mock;
    getLatestPopulation: jest.Mock;
  };
  let historicalService: { findRelevantForHazardEvent: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let weatherSampleRepository: { query: jest.Mock };
  let hazardIndexRepository: { findOne: jest.Mock };
  let terrainRepository: { findOne: jest.Mock };
  let service: RiskEngineOrchestrationService;

  beforeEach(() => {
    earthquakeDetailsRepository = makeDetailsRepo({
      magnitude: null,
      depthKm: null,
    });
    landslideDetailsRepository = makeDetailsRepo({
      slopeDegrees: null,
      soilSaturation: null,
      triggeringRainfallMm: null,
    });
    floodDetailsRepository = makeDetailsRepo({
      rainfallMm: null,
      waterLevelM: null,
    });
    wildfireDetailsRepository = makeDetailsRepo({
      frpConfidence: null,
      hotspotCount: null,
      brightnessKelvin: null,
    });

    riskAssessmentRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 'risk-assessment-1', ...input })),
      update: jest.fn(),
    };
    decisionRecommendationRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 'decision-1', ...input })),
    };
    riskEngineClient = {
      predictRisk: jest.fn().mockResolvedValue({
        hazardType: HazardType.EARTHQUAKE,
        riskScore: 42,
        exposureLevel: 'moderate',
        estimatedAffectedPopulation: 1000,
        confidenceScore: 0.5,
        modelVersion: 'test',
      }),
      calculatePriority: jest.fn().mockResolvedValue({
        priorityLevel: 'medium',
        priorityScore: 40,
        confidenceScore: 0.5,
      }),
      generateRecommendation: jest.fn().mockResolvedValue({
        summaryText: 'test summary',
        reasons: [],
        actionRecommendation: null,
        confidenceScore: 0.5,
      }),
    };
    geoService = {
      getDistrictCentroid: jest
        .fn()
        .mockResolvedValue({ latitude: -7.5, longitude: 110.2 }),
      findDistrictOrThrow: jest.fn().mockResolvedValue(district),
      getLatestPopulation: jest.fn().mockResolvedValue({
        totalPopulation: 500_000,
        populationDensity: 800,
      }),
    };
    historicalService = {
      findRelevantForHazardEvent: jest.fn().mockResolvedValue([]),
    };
    eventEmitter = { emit: jest.fn() };
    weatherSampleRepository = { query: jest.fn().mockResolvedValue([]) };
    hazardIndexRepository = { findOne: jest.fn().mockResolvedValue(null) };
    terrainRepository = { findOne: jest.fn().mockResolvedValue(null) };

    service = new RiskEngineOrchestrationService(
      { findOneOrFail: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      riskAssessmentRepository as any,
      decisionRecommendationRepository as any,
      { find: jest.fn().mockResolvedValue([district]) } as any,
      earthquakeDetailsRepository as any,
      landslideDetailsRepository as any,
      floodDetailsRepository as any,
      wildfireDetailsRepository as any,
      riskEngineClient as any,
      geoService as any,
      historicalService as any,
      eventEmitter as unknown as EventEmitter2,
      weatherSampleRepository as any,
      hazardIndexRepository as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      terrainRepository as any,
    );
  });

  describe('runBaselineScan', () => {
    it('produces a real risk assessment per district/hazard type instead of skipping (regression: the pre-fix bug)', async () => {
      await service.runBaselineScan();

      // One predict-risk call per hazard type (earthquake/landslide/flood/
      // wildfire) for the single seeded district — previously zero, since
      // buildHazardEventInput() always returned null for baseline scans.
      expect(riskEngineClient.predictRisk).toHaveBeenCalledTimes(4);

      const earthquakeCall = riskEngineClient.predictRisk.mock.calls.find(
        ([payload]) => payload.hazardEvent.hazardType === HazardType.EARTHQUAKE,
      );
      expect(earthquakeCall[0].hazardEvent.earthquake).toBeDefined();

      // Every risk assessment reaches COMPLETED, not FAILED/skipped.
      expect(riskAssessmentRepository.save).toHaveBeenCalled();
      expect(
        riskAssessmentRepository.save.mock.calls.some(
          ([input]) => input.status === RiskAssessmentStatus.COMPLETED,
        ),
      ).toBe(true);
    });

    it('falls back to BASELINE_DEFAULTS when a district has no matching history', async () => {
      await service.runBaselineScan();

      const earthquakeCall = riskEngineClient.predictRisk.mock.calls.find(
        ([payload]) => payload.hazardEvent.hazardType === HazardType.EARTHQUAKE,
      );
      // BASELINE_DEFAULTS[EARTHQUAKE] = { magnitude: 4.0, depthKm: 10 }.
      expect(earthquakeCall[0].hazardEvent.earthquake).toEqual({
        magnitude: 4.0,
        depthKm: 10,
      });
    });

    it('prefers averaged district history over defaults when it exists', async () => {
      earthquakeDetailsRepository.createQueryBuilder.mockReturnValue(
        averageQueryBuilderMock({ magnitude: '6.2', depthKm: '15.5' }),
      );

      await service.runBaselineScan();

      const earthquakeCall = riskEngineClient.predictRisk.mock.calls.find(
        ([payload]) => payload.hazardEvent.hazardType === HazardType.EARTHQUAKE,
      );
      expect(earthquakeCall[0].hazardEvent.earthquake).toEqual({
        magnitude: 6.2,
        depthKm: 15.5,
      });
    });
  });

  describe('flood baseline inputs', () => {
    const floodCall = () =>
      riskEngineClient.predictRisk.mock.calls.find(
        ([payload]) => payload.hazardEvent.hazardType === HazardType.FLOOD,
      );
    const floodSnapshot = () =>
      riskAssessmentRepository.create.mock.calls.find(
        ([input]) => input.hazardType === HazardType.FLOOD,
      )[0].inputSnapshot;

    it('uses stored live rainfall and the InaRISK index over defaults, and records the sources', async () => {
      const latest = new Date();
      latest.setUTCMinutes(0, 0, 0);
      weatherSampleRepository.query.mockResolvedValue(
        Array.from({ length: 24 }, (_, i) => ({
          source: 'gsmap_gauge_now',
          valid_time: new Date(latest.getTime() - i * 3_600_000),
          precipitation_mm: 2,
        })),
      );
      hazardIndexRepository.findOne.mockResolvedValue({ valueMean: 0.42 });

      await service.runBaselineScan();

      expect(floodCall()[0].hazardEvent.flood).toEqual({
        rainfallMm: 48,
        waterLevelM: 0.5,
        floodHazardIndex: 0.42,
      });
      expect(floodSnapshot().baselineInputSources).toEqual({
        rainfallMm: expect.stringContaining('gsmap_gauge_now trailing 24 h'),
        waterLevelM: 'baseline_default',
        floodHazardIndex: expect.stringContaining('bnpb_inarisk'),
      });
    });

    it('falls back to history/defaults when live data is missing or the query fails', async () => {
      weatherSampleRepository.query.mockRejectedValue(new Error('no table'));

      await service.runBaselineScan();

      expect(floodCall()[0].hazardEvent.flood).toEqual({
        rainfallMm: 5,
        waterLevelM: 0.5,
        floodHazardIndex: 0.1,
      });
      expect(floodSnapshot().baselineInputSources.rainfallMm).toBe(
        'baseline_default',
      );
      // Hazard types without live inputs carry no baselineInputSources.
      const quake = riskAssessmentRepository.create.mock.calls.find(
        ([input]) => input.hazardType === HazardType.EARTHQUAKE,
      )[0].inputSnapshot;
      expect(quake.baselineInputSources).toBeUndefined();
    });
  });

  describe('landslide baseline inputs', () => {
    const landslideCall = () =>
      riskEngineClient.predictRisk.mock.calls.find(
        ([payload]) => payload.hazardEvent.hazardType === HazardType.LANDSLIDE,
      );
    const landslideSnapshot = () =>
      riskAssessmentRepository.create.mock.calls.find(
        ([input]) => input.hazardType === HazardType.LANDSLIDE,
      )[0].inputSnapshot;

    it('uses stored rainfall and the p90 DEM slope over defaults, and records the sources', async () => {
      const latest = new Date();
      latest.setUTCMinutes(0, 0, 0);
      weatherSampleRepository.query.mockResolvedValue(
        Array.from({ length: 24 }, (_, i) => ({
          source: 'gsmap_gauge_now',
          valid_time: new Date(latest.getTime() - i * 3_600_000),
          precipitation_mm: 3,
        })),
      );
      terrainRepository.findOne.mockResolvedValue({
        slopeSamplesDeg: [...new Array(10).fill(5), ...new Array(6).fill(28)],
      });

      await service.runBaselineScan();

      expect(landslideCall()[0].hazardEvent.landslide).toEqual({
        slopeDegrees: 28,
        soilSaturation: 0.2,
        triggeringRainfallMm: 72,
      });
      expect(landslideSnapshot().baselineInputSources).toEqual({
        slopeDegrees: expect.stringContaining('Copernicus GLO-90 p90'),
        soilSaturation: 'baseline_default',
        triggeringRainfallMm: expect.stringContaining(
          'gsmap_gauge_now trailing 24 h',
        ),
      });
    });

    it('ignores a terrain profile with too few land samples', async () => {
      terrainRepository.findOne.mockResolvedValue({ slopeSamplesDeg: [40] });

      await service.runBaselineScan();

      expect(landslideCall()[0].hazardEvent.landslide.slopeDegrees).toBe(10);
      expect(landslideSnapshot().baselineInputSources.slopeDegrees).toBe(
        'baseline_default',
      );
    });
  });

  describe('handleHazardEventCreated (event-triggered path, unaffected by the baseline fix)', () => {
    it('skips a district when the matching *_details row is missing, without touching the baseline path', async () => {
      const hazardEvent = {
        id: 'hazard-event-1',
        hazardType: HazardType.EARTHQUAKE,
        latitude: -7.5,
        longitude: 110.2,
        eventTime: new Date('2026-01-01T00:00:00Z'),
      };
      const hazardEventRepository = {
        findOneOrFail: jest.fn().mockResolvedValue(hazardEvent),
      };
      earthquakeDetailsRepository.findOne.mockResolvedValue(null);

      service = new RiskEngineOrchestrationService(
        hazardEventRepository as any,
        { findOne: jest.fn().mockResolvedValue(null) } as any,
        riskAssessmentRepository as any,
        decisionRecommendationRepository as any,
        { find: jest.fn() } as any,
        earthquakeDetailsRepository as any,
        landslideDetailsRepository as any,
        floodDetailsRepository as any,
        wildfireDetailsRepository as any,
        riskEngineClient as any,
        geoService as any,
        historicalService as any,
        eventEmitter as unknown as EventEmitter2,
        weatherSampleRepository as any,
        hazardIndexRepository as any,
        { get: jest.fn() } as any,
        terrainRepository as any,
      );

      await service.handleHazardEventCreated({
        hazardEventId: 'hazard-event-1',
        hazardType: HazardType.EARTHQUAKE,
        affectedDistrictIds: [districtId],
      });

      expect(riskEngineClient.predictRisk).not.toHaveBeenCalled();
      expect(riskAssessmentRepository.save).not.toHaveBeenCalled();
    });
  });
});
