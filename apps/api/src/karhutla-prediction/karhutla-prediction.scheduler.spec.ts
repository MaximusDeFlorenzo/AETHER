import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { KarhutlaRunTrigger } from './karhutla.enums';
import { KarhutlaPredictionScheduler } from './karhutla-prediction.scheduler';
import { KarhutlaPredictionService } from './karhutla-prediction.service';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-23T16:00:00Z');

function build(latestCreatedAt: Date | null) {
  const service = {
    listRuns: jest.fn(async () =>
      latestCreatedAt ? [{ createdAt: latestCreatedAt }] : [],
    ),
    requestRun: jest.fn(async () => ({
      run: { id: 'run-1' },
      deduplicated: false,
    })),
  };
  const scheduler = new KarhutlaPredictionScheduler(
    service as unknown as KarhutlaPredictionService,
    {} as ConfigService,
    {} as SchedulerRegistry,
  );
  return { scheduler, service };
}

describe('KarhutlaPredictionScheduler.catchUp', () => {
  it('queues a scheduled run when the newest run is older than the interval', async () => {
    const { scheduler, service } = build(new Date(NOW.getTime() - 7 * HOUR));
    await scheduler.catchUp(3 * HOUR, NOW);
    expect(service.requestRun).toHaveBeenCalledWith({
      trigger: KarhutlaRunTrigger.SCHEDULED,
    });
  });

  it('does nothing when a recent run exists (restarts cost no extra runs)', async () => {
    const { scheduler, service } = build(new Date(NOW.getTime() - HOUR));
    await scheduler.catchUp(3 * HOUR, NOW);
    expect(service.requestRun).not.toHaveBeenCalled();
  });

  it('queues the first run when none exists yet', async () => {
    const { scheduler, service } = build(null);
    await scheduler.catchUp(3 * HOUR, NOW);
    expect(service.requestRun).toHaveBeenCalledTimes(1);
  });
});
