import { IngestionScheduler } from './ingestion.scheduler';

describe('IngestionScheduler', () => {
  let ingestionRegistryService: {
    listSourceIds: jest.Mock;
    triggerSync: jest.Mock;
  };
  let config: { get: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    doesExist: jest.Mock;
    deleteInterval: jest.Mock;
  };
  let scheduler: IngestionScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    ingestionRegistryService = {
      listSourceIds: jest
        .fn()
        .mockReturnValue(['bmkg', 'sentinel', 'landslide_rainfall_trigger']),
      triggerSync: jest
        .fn()
        .mockResolvedValue({ newEventsIngested: 0, eventsFetched: 0 }),
    };
    config = {
      get: jest.fn((key: string) => {
        if (key === 'BMKG_POLL_INTERVAL_MS') return 300_000;
        if (key === 'SENTINEL_POLL_INTERVAL_MS') return 3_600_000;
        if (key === 'LANDSLIDE_TRIGGER_POLL_INTERVAL_MS') return 900_000;
        return undefined;
      }),
    };
    schedulerRegistry = {
      addInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(true),
      deleteInterval: jest.fn(),
    };

    scheduler = new IngestionScheduler(
      ingestionRegistryService as any,
      config as any,
      schedulerRegistry as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers one interval per registered adapter source, using each source\'s configured poll interval', () => {
    scheduler.onModuleInit();

    expect(schedulerRegistry.addInterval).toHaveBeenCalledTimes(3);
    const registeredNames = schedulerRegistry.addInterval.mock.calls.map(
      ([name]) => name,
    );
    expect(registeredNames).toEqual([
      'ingestion-poll-bmkg',
      'ingestion-poll-sentinel',
      'ingestion-poll-landslide_rainfall_trigger',
    ]);
  });

  it('polls every registered source immediately on startup, not just after the first interval elapses', async () => {
    scheduler.onModuleInit();
    // Let the fire-and-forget `void this.poll(sourceId)` promises resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(ingestionRegistryService.triggerSync).toHaveBeenCalledWith('bmkg');
    expect(ingestionRegistryService.triggerSync).toHaveBeenCalledWith(
      'sentinel',
    );
    expect(ingestionRegistryService.triggerSync).toHaveBeenCalledWith(
      'landslide_rainfall_trigger',
    );
  });

  it('polls again once the configured interval elapses', async () => {
    scheduler.onModuleInit();
    await Promise.resolve();
    ingestionRegistryService.triggerSync.mockClear();

    jest.advanceTimersByTime(300_000);
    await Promise.resolve();

    expect(ingestionRegistryService.triggerSync).toHaveBeenCalledWith('bmkg');
  });

  it('a single source failing to sync does not stop other sources from being polled', async () => {
    ingestionRegistryService.triggerSync.mockImplementation(
      (sourceId: string) =>
        sourceId === 'sentinel'
          ? Promise.reject(new Error('network error'))
          : Promise.resolve({ newEventsIngested: 0, eventsFetched: 0 }),
    );

    scheduler.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(ingestionRegistryService.triggerSync).toHaveBeenCalledWith('bmkg');
    expect(ingestionRegistryService.triggerSync).toHaveBeenCalledWith(
      'landslide_rainfall_trigger',
    );
  });

  it('removes every registered interval on module destroy', () => {
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();

    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledTimes(3);
  });
});
