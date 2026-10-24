import { ResourceOptimizationService } from './resource-optimization.service';
import type { DecisionRecommendationCreatedEvent } from '../common/events/domain-events';

describe('ResourceOptimizationService.handleDecisionRecommendationCreated', () => {
  let planRepository: { save: jest.Mock; create: jest.Mock };
  let riskEngineClient: { optimizeResources: jest.Mock };
  let config: { get: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let service: ResourceOptimizationService;

  const baseEvent: DecisionRecommendationCreatedEvent = {
    decisionRecommendationId: 'rec-1',
    riskAssessmentId: 'assessment-1',
    hazardEventId: 'event-1',
    hazardType: 'earthquake',
    districtId: 'district-1',
    districtName: 'Kabupaten Test',
    priorityLevel: 'critical',
    priorityScore: 90,
    exposureLevel: 'severe',
    estimatedAffectedPopulation: 1000,
  };

  beforeEach(() => {
    planRepository = {
      save: jest
        .fn()
        .mockImplementation((v) => Promise.resolve({ id: 'plan-1', ...v })),
      create: jest.fn((v) => v),
    };
    riskEngineClient = { optimizeResources: jest.fn() };
    config = { get: jest.fn().mockReturnValue(60) };
    eventEmitter = { emit: jest.fn() };

    service = new ResourceOptimizationService(
      planRepository as any,
      {} as any,
      riskEngineClient as any,
      config as any,
      eventEmitter as any,
    );
  });

  it('does NOT call the resource-optimization engine when estimatedAffectedPopulation is null (unknown, not zero)', async () => {
    await service.handleDecisionRecommendationCreated({
      ...baseEvent,
      estimatedAffectedPopulation: null,
    });

    expect(riskEngineClient.optimizeResources).not.toHaveBeenCalled();
    expect(planRepository.save).not.toHaveBeenCalled();
  });

  it('calls the engine with the real number when estimatedAffectedPopulation is a genuine zero', async () => {
    riskEngineClient.optimizeResources.mockResolvedValue({
      volunteers: { total: 0 },
    });

    await service.handleDecisionRecommendationCreated({
      ...baseEvent,
      estimatedAffectedPopulation: 0,
    });

    expect(riskEngineClient.optimizeResources).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedAffectedPopulation: 0 }),
    );
  });

  it('calls the engine normally when estimatedAffectedPopulation is a real positive number', async () => {
    riskEngineClient.optimizeResources.mockResolvedValue({
      volunteers: { total: 12 },
    });

    await service.handleDecisionRecommendationCreated(baseEvent);

    expect(riskEngineClient.optimizeResources).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedAffectedPopulation: 1000 }),
    );
    expect(planRepository.save).toHaveBeenCalled();
  });

  it('skips below the priority threshold regardless of population data', async () => {
    await service.handleDecisionRecommendationCreated({
      ...baseEvent,
      priorityScore: 10,
    });

    expect(riskEngineClient.optimizeResources).not.toHaveBeenCalled();
  });
});
