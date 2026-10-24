import { of, throwError } from 'rxjs';
import { OPEN_METEO_HOURLY_VARIABLES } from './lib/normalize';
import { RainfallIngestionService } from './rainfall-ingestion.service';
import { WeatherDataKind } from './rainfall.enums';

// Retries are retry.ts's concern (tested with the karhutla providers); here
// they'd only add real backoff delays.
jest.mock('../karhutla-prediction/providers/retry', () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const NOW = new Date('2026-10-06T13:09:00Z');

/** Chainable TypeORM query-builder stub; records inserted rows. */
function queryBuilder(result: unknown = []) {
  const inserted: unknown[][] = [];
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'addSelect',
    'orderBy',
    'insert',
    'into',
    'orUpdate',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.values = jest.fn((rows: unknown[]) => {
    inserted.push(rows);
    return qb;
  });
  qb.getRawMany = jest.fn().mockResolvedValue(result);
  qb.execute = jest.fn().mockResolvedValue({});
  return { qb, inserted };
}

function openMeteoLocation(times: string[]) {
  const hourly: Record<string, unknown> = { time: times };
  for (const variable of OPEN_METEO_HOURLY_VARIABLES) {
    hourly[variable] = times.map(() => (variable === 'precipitation' ? 2 : 10));
  }
  return {
    elevation: 20,
    hourly_units: {
      precipitation: 'mm',
      wind_speed_10m: 'km/h',
      wind_direction_10m: '°',
      wind_speed_850hPa: 'km/h',
      wind_direction_850hPa: '°',
      wind_speed_700hPa: 'km/h',
      wind_direction_700hPa: '°',
      temperature_2m: '°C',
      relative_humidity_2m: '%',
      surface_pressure: 'hPa',
      soil_moisture_9_to_27cm: 'm³/m³',
    },
    hourly,
  };
}

function build({
  districts = [
    { id: 'd1', latitude: '-6.2', longitude: '106.8' },
    { id: 'd2', latitude: '-0.9', longitude: '119.9' },
  ],
  coverage = { districts: '0', oldestLatest: null as Date | null },
} = {}) {
  const http = { get: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const districtQb = queryBuilder(districts);
  const sampleQb = queryBuilder();
  const districtRepository = {
    createQueryBuilder: jest.fn(() => districtQb.qb),
  };
  const sampleRepository = {
    createQueryBuilder: jest.fn(() => sampleQb.qb),
    query: jest.fn().mockResolvedValue([coverage]),
  };
  const sync = { recordSuccess: jest.fn(), recordFailure: jest.fn() };
  const service = new RainfallIngestionService(
    http as never,
    config as never,
    districtRepository as never,
    sampleRepository as never,
    sync as never,
  );
  return { service, http, sync, inserted: sampleQb.inserted };
}

describe('RainfallIngestionService', () => {
  it('backfills one week on the first run and upserts normalized past hours only', async () => {
    const { service, http, sync, inserted } = build();
    const times = ['2026-10-06T12:00', '2026-10-06T13:00', '2026-10-06T14:00'];
    http.get.mockReturnValue(
      of({ data: [openMeteoLocation(times), openMeteoLocation(times)] }),
    );

    const summary = await service.ingest(NOW);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0][1].params).toEqual(
      expect.objectContaining({
        latitude: '-6.2,-0.9',
        longitude: '106.8,119.9',
        past_hours: 168,
        forecast_hours: 1,
        timezone: 'GMT',
        wind_speed_unit: 'kmh',
      }),
    );
    expect(summary).toEqual(
      expect.objectContaining({
        districts: 2,
        lookbackHours: 168,
        samplesWritten: 4,
        futureHoursDropped: 2,
        batchesFailed: 0,
      }),
    );
    const rows = inserted.flat() as Array<Record<string, unknown>>;
    expect(rows[0]).toEqual(
      expect.objectContaining({
        district: { id: 'd1' },
        source: 'open-meteo',
        dataKind: WeatherDataKind.NWP_MODEL,
        validTime: new Date('2026-10-06T12:00:00Z'),
        precipitationMm: 2,
      }),
    );
    expect(sync.recordSuccess).toHaveBeenCalledWith('rainfall_open_meteo');
  });

  it('only fetches back to the most-behind district once all have history', async () => {
    const { service, http } = build({
      coverage: {
        districts: '2',
        oldestLatest: new Date('2026-10-06T07:00:00Z'),
      },
    });
    http.get.mockReturnValue(of({ data: [] }));

    const summary = await service.ingest(NOW);

    // 6.15 h gap → 7 h, +1 h overlap = 8 h (above the 3 h + 1 h minimum).
    expect(summary?.lookbackHours).toBe(8);
    expect(http.get.mock.calls[0][1].params.past_hours).toBe(8);
  });

  it('records a failure when every batch fails, without throwing', async () => {
    const { service, http, sync } = build();
    http.get.mockReturnValue(
      throwError(() =>
        Object.assign(new Error('Bad Request'), {
          response: { status: 400 },
        }),
      ),
    );

    const summary = await service.ingest(NOW);

    expect(summary).toEqual(
      expect.objectContaining({
        batchesFailed: 1,
        districtsWithoutData: 2,
        samplesWritten: 0,
      }),
    );
    expect(sync.recordFailure).toHaveBeenCalled();
    expect(sync.recordSuccess).not.toHaveBeenCalled();
  });

  it('stops at the first HTTP 429 instead of hammering a shared quota', async () => {
    const districts = Array.from({ length: 120 }, (_, i) => ({
      id: `d${i}`,
      latitude: '-6',
      longitude: '106',
    }));
    const { service, http, sync } = build({ districts });
    http.get.mockReturnValue(
      throwError(() =>
        Object.assign(new Error('Too Many Requests'), {
          response: { status: 429 },
        }),
      ),
    );

    const summary = await service.ingest(NOW);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(summary).toEqual(
      expect.objectContaining({
        rateLimited: true,
        batches: 1,
        districtsWithoutData: 120,
        samplesWritten: 0,
      }),
    );
    expect(sync.recordFailure).toHaveBeenCalledWith(
      'rainfall_open_meteo',
      expect.stringContaining('429'),
    );
  });

  it('refuses a concurrent run', async () => {
    const { service, http } = build();
    let release: (value: unknown) => void = () => undefined;
    http.get.mockReturnValue(of({ data: [] }));
    const sampleQuery = new Promise((resolve) => {
      release = resolve;
    });
    // Hold the first run inside the coverage query.
    (
      service as never as { sampleRepository: { query: jest.Mock } }
    ).sampleRepository.query.mockReturnValueOnce(
      sampleQuery.then(() => [{ districts: '0', oldestLatest: null }]),
    );

    const first = service.ingest(NOW);
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.isRunning()).toBe(true);
    await expect(service.ingest(NOW)).resolves.toBeNull();
    release(undefined);
    await first;
    expect(service.isRunning()).toBe(false);
  });
});
