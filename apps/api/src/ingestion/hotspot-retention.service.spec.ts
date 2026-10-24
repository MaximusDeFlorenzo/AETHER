import {
  HotspotRetentionService,
  RETENTION_BATCH_SIZE,
} from './hotspot-retention.service';

describe('HotspotRetentionService', () => {
  let execute: jest.Mock;
  let where: jest.Mock;
  let days: number | undefined;
  let service: HotspotRetentionService;

  beforeEach(() => {
    execute = jest.fn();
    where = jest.fn();
    const builder = {
      delete: () => builder,
      from: () => builder,
      where: (...args: unknown[]) => {
        where(...args);
        return builder;
      },
      execute,
    };
    days = 90;
    service = new HotspotRetentionService(
      { createQueryBuilder: () => builder } as never,
      { get: () => days } as never,
    );
  });

  const now = new Date('2026-10-23T03:00:00Z');

  it('deletes in batches until a short batch, with a 90-day cutoff', async () => {
    execute
      .mockResolvedValueOnce({ affected: RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ affected: RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ affected: 12 });

    const result = await service.purge(now);

    expect(result).toEqual({
      deleted: RETENTION_BATCH_SIZE * 2 + 12,
      cutoff: new Date('2026-07-25T03:00:00Z'),
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(where.mock.calls[0][1]).toEqual({
      source: 'nasa_firms',
      cutoff: new Date('2026-07-25T03:00:00Z'),
      limit: RETENTION_BATCH_SIZE,
    });
  });

  it('only deletes detections nothing else references', async () => {
    execute.mockResolvedValue({ affected: 0 });
    await service.purge(now);
    const sql = where.mock.calls[0][0] as string;
    for (const table of [
      'risk_assessments',
      'notifications',
      'resource_optimization_plans',
      'hazard_relationships',
      'cv_detections',
      'public_alerts',
    ]) {
      expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM ${table}`);
    }
  });

  it('does nothing when retention is disabled', async () => {
    days = 0;
    expect(await service.purge(now)).toEqual({ deleted: 0, cutoff: null });
    expect(execute).not.toHaveBeenCalled();
  });

  it('never runs two purges at once', async () => {
    let release!: (value: { affected: number }) => void;
    execute.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

    const first = service.purge(now);
    expect(await service.purge(now)).toEqual({ deleted: 0, cutoff: null });
    release({ affected: 3 });
    expect((await first).deleted).toBe(3);
  });

  it('logs instead of throwing from the scheduled run', async () => {
    execute.mockRejectedValue(new Error('db down'));
    await expect(service.scheduledPurge()).resolves.toBeUndefined();
  });
});
