import { ServiceUnavailableException } from '@nestjs/common';
import { KarhutlaPredictionService } from './karhutla-prediction.service';
import { KarhutlaRunStatus, KarhutlaRunTrigger } from './karhutla.enums';

function build() {
  const runRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => ({ id: 'run-1', createdAt: new Date(), ...v })),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new KarhutlaPredictionService(
    runRepository as never,
    { find: jest.fn() } as never,
    queue as never,
    config as never,
  );
  return { service, runRepository, queue };
}

describe('KarhutlaPredictionService.requestRun', () => {
  it('queues a new run with default horizons and jobId = run id', async () => {
    const { service, runRepository, queue } = build();
    runRepository.findOne.mockResolvedValue(null);
    const { run, deduplicated } = await service.requestRun({
      trigger: KarhutlaRunTrigger.MANUAL,
      userId: 'u1',
    });
    expect(deduplicated).toBe(false);
    expect(run.horizonsHours).toEqual([1, 3, 6, 12]);
    expect(run.status).toBe(KarhutlaRunStatus.QUEUED);
    expect(queue.add).toHaveBeenCalledWith(
      'run',
      { runId: 'run-1' },
      expect.objectContaining({ jobId: 'run-1', attempts: 2 }),
    );
  });

  it('returns the active run instead of queuing a duplicate', async () => {
    const { service, runRepository, queue } = build();
    runRepository.findOne.mockResolvedValue({
      id: 'active',
      status: KarhutlaRunStatus.RUNNING,
      horizonsHours: [1],
    });
    const { run, deduplicated } = await service.requestRun({
      trigger: KarhutlaRunTrigger.SCHEDULED,
    });
    expect(deduplicated).toBe(true);
    expect(run.id).toBe('active');
    expect(runRepository.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('resolves a concurrent-insert race via the unique index', async () => {
    const { service, runRepository, queue } = build();
    runRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'winner',
      status: KarhutlaRunStatus.QUEUED,
      horizonsHours: [1],
    });
    runRepository.save.mockRejectedValue(
      Object.assign(new Error('dup'), { code: '23505' }),
    );
    const { run, deduplicated } = await service.requestRun({
      trigger: KarhutlaRunTrigger.MANUAL,
    });
    expect(deduplicated).toBe(true);
    expect(run.id).toBe('winner');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks the run failed and reports 503 when the queue is down', async () => {
    const { service, runRepository, queue } = build();
    runRepository.findOne.mockResolvedValue(null);
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      service.requestRun({ trigger: KarhutlaRunTrigger.MANUAL }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(runRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: KarhutlaRunStatus.FAILED }),
    );
  });

  it('reaps abandoned queued/running runs before checking for an active one', async () => {
    const { service, runRepository } = build();
    runRepository.update.mockResolvedValueOnce({ affected: 1 });
    runRepository.findOne.mockResolvedValue(null);
    await service.requestRun({ trigger: KarhutlaRunTrigger.SCHEDULED });
    const [criteria, patch] = runRepository.update.mock.calls[0];
    expect(criteria.createdAt).toBeDefined();
    expect(patch.status).toBe(KarhutlaRunStatus.FAILED);
    expect(patch.error).toMatch(/Abandoned/);
  });
});
