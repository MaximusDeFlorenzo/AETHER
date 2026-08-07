import { NotFoundException } from '@nestjs/common';
import { DecisionIntelligenceService } from './decision-intelligence.service';
import { HazardType, PriorityLevel } from '../common/enums/domain.enum';

function queryBuilderMock(result: { data: unknown[]; total: number }) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'leftJoinAndSelect',
    'orderBy',
    'andWhere',
    'skip',
    'take',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue([result.data, result.total]);
  return qb;
}

describe('DecisionIntelligenceService', () => {
  describe('findAll', () => {
    it('applies priorityLevel and hazardType as query-builder filters', async () => {
      const qb = queryBuilderMock({ data: [{ id: 'rec-1' }], total: 1 });
      const repository = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
      const service = new DecisionIntelligenceService(repository as any);

      const result = await service.findAll({
        priorityLevel: PriorityLevel.HIGH,
        hazardType: HazardType.FLOOD,
        page: 1,
        limit: 20,
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'rec.priorityLevel = :priorityLevel',
        {
          priorityLevel: PriorityLevel.HIGH,
        },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'riskAssessment.hazardType = :hazardType',
        { hazardType: HazardType.FLOOD },
      );
      expect(result).toEqual({
        data: [{ id: 'rec-1' }],
        meta: { page: 1, limit: 20, total: 1 },
      });
    });

    it('omits filters that were not provided', async () => {
      const qb = queryBuilderMock({ data: [], total: 0 });
      const repository = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
      const service = new DecisionIntelligenceService(repository as any);

      await service.findAll({ page: 1, limit: 20 });

      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('paginates using skip/take derived from page and limit', async () => {
      const qb = queryBuilderMock({ data: [], total: 0 });
      const repository = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
      const service = new DecisionIntelligenceService(repository as any);

      await service.findAll({ page: 3, limit: 10 });

      expect(qb.skip).toHaveBeenCalledWith(20);
      expect(qb.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findOne', () => {
    it('returns the recommendation with its risk-assessment/district/hazard-event relations', async () => {
      const recommendation = { id: 'rec-1' };
      const repository = {
        findOne: jest.fn().mockResolvedValue(recommendation),
      };
      const service = new DecisionIntelligenceService(repository as any);

      const result = await service.findOne('rec-1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        relations: { riskAssessment: { district: true, hazardEvent: true } },
      });
      expect(result).toBe(recommendation);
    });

    it('throws NotFoundException when no recommendation matches', async () => {
      const repository = { findOne: jest.fn().mockResolvedValue(null) };
      const service = new DecisionIntelligenceService(repository as any);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
