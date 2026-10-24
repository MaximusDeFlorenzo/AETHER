import { IngestionRegistryService } from './ingestion-registry.service';

describe('IngestionRegistryService', () => {
  let hazardEventsService: {
    ingestEvent: jest.Mock;
    ingestEventWithoutAnnouncing: jest.Mock;
    announce: jest.Mock;
  };
  let dataSourceSyncService: {
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };

  beforeEach(() => {
    hazardEventsService = {
      ingestEvent: jest.fn().mockResolvedValue({ id: 'e' }),
      ingestEventWithoutAnnouncing: jest.fn((raw: { id: string }) =>
        Promise.resolve(
          raw.id === 'known'
            ? null
            : {
                hazardEvent: { id: raw.id },
                announcement: { hazardEventId: raw.id },
              },
        ),
      ),
      announce: jest.fn(),
    };
    dataSourceSyncService = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
  });

  const registry = (adapter: object) =>
    new IngestionRegistryService(
      [adapter as never],
      hazardEventsService as never,
      dataSourceSyncService as never,
    );

  it('announces every new event individually by default', async () => {
    const result = await registry({
      sourceId: 'bmkg',
      fetch: jest.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
      normalize: (raw: unknown) => raw,
    }).triggerSync('bmkg');

    expect(hazardEventsService.ingestEvent).toHaveBeenCalledTimes(2);
    expect(
      hazardEventsService.ingestEventWithoutAnnouncing,
    ).not.toHaveBeenCalled();
    expect(result).toEqual({ newEventsIngested: 2, eventsFetched: 2 });
  });

  it('lets an adapter with selectAnnouncements choose what is announced', async () => {
    const selectAnnouncements = jest
      .fn()
      .mockResolvedValue([{ hazardEventId: '2' }]);

    const result = await registry({
      sourceId: 'nasa_firms',
      fetch: jest
        .fn()
        .mockResolvedValue([{ id: '1' }, { id: 'known' }, { id: '2' }]),
      normalize: (raw: unknown) => raw,
      selectAnnouncements,
    }).triggerSync('nasa_firms');

    expect(hazardEventsService.ingestEvent).not.toHaveBeenCalled();
    expect(selectAnnouncements).toHaveBeenCalledWith([
      { hazardEvent: { id: '1' }, announcement: { hazardEventId: '1' } },
      { hazardEvent: { id: '2' }, announcement: { hazardEventId: '2' } },
    ]);
    expect(hazardEventsService.announce).toHaveBeenCalledTimes(1);
    expect(hazardEventsService.announce).toHaveBeenCalledWith({
      hazardEventId: '2',
    });
    expect(result).toEqual({ newEventsIngested: 2, eventsFetched: 3 });
  });

  it('skips selectAnnouncements when nothing new was ingested', async () => {
    const selectAnnouncements = jest.fn();
    await registry({
      sourceId: 'nasa_firms',
      fetch: jest.fn().mockResolvedValue([{ id: 'known' }]),
      normalize: (raw: unknown) => raw,
      selectAnnouncements,
    }).triggerSync('nasa_firms');

    expect(selectAnnouncements).not.toHaveBeenCalled();
  });
});
