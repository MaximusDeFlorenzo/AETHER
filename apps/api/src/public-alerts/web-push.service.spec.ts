import * as webpush from 'web-push';
import { notificationBody, WebPushService } from './web-push.service';
import { PublicAlertHazard, PublicAlertStatus } from './public-alert.enums';
import type { PublicAlert } from '../database/entities';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const mockedWebpush = webpush as jest.Mocked<typeof webpush>;

function createQueryBuilderMock(result: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['where', 'andWhere']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(result);
  return qb;
}

function buildAlert(overrides: Partial<PublicAlert> = {}): PublicAlert {
  return {
    id: 'alert-1234-5678',
    hazard: PublicAlertHazard.FLOOD,
    status: PublicAlertStatus.ACTIVE,
    title: 'Awas banjir',
    action: 'Pergi ke posko sekarang',
    message: 'Air naik cepat.',
    destinationName: 'Posko SDN 2',
    district: { id: 'district-1' },
    subdistrict: null,
    village: null,
    ...overrides,
  } as PublicAlert;
}

function buildService(env: Record<string, string | undefined>) {
  const subscriptionRepository = {
    createQueryBuilder: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const alertRepository = { update: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((key: string) => env[key]) };
  const service = new WebPushService(
    config as any,
    subscriptionRepository as any,
    alertRepository as any,
  );
  service.onModuleInit();
  return { service, subscriptionRepository, alertRepository };
}

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: 'private-key',
  VAPID_SUBJECT: 'mailto:ops@example.test',
};

describe('WebPushService.findRecipients', () => {
  it('scopes to the alert district only when the alert targets a whole district', async () => {
    const { service, subscriptionRepository } = buildService(VAPID_ENV);
    const qb = createQueryBuilderMock([]);
    subscriptionRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findRecipients(buildAlert());

    expect(qb.where).toHaveBeenCalledWith('sub.district_id = :district', {
      district: 'district-1',
    });
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('still includes subscribers who picked only a coarser area when the alert narrows to a village', async () => {
    const { service, subscriptionRepository } = buildService(VAPID_ENV);
    const qb = createQueryBuilderMock([]);
    subscriptionRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findRecipients(
      buildAlert({
        subdistrict: { id: 'sub-1' } as PublicAlert['subdistrict'],
        village: { id: 'village-1' } as PublicAlert['village'],
      }),
    );

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(sub.subdistrict_id IS NULL OR sub.subdistrict_id = :subdistrict)',
      { subdistrict: 'sub-1' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(sub.village_id IS NULL OR sub.village_id = :village)',
      { village: 'village-1' },
    );
  });
});

describe('WebPushService.sendAlert', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a no-op without VAPID keys (alarms still reach open tabs by polling)', async () => {
    const { service, subscriptionRepository } = buildService({});

    const result = await service.sendAlert(buildAlert());

    expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(subscriptionRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(mockedWebpush.sendNotification).not.toHaveBeenCalled();
  });

  it('sends a high-urgency payload that deep-links to the red alarm screen', async () => {
    const { service, subscriptionRepository } = buildService(VAPID_ENV);
    subscriptionRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilderMock([
        { id: 's1', endpoint: 'https://push/1', p256dh: 'k', auth: 'a' },
      ]),
    );
    mockedWebpush.sendNotification.mockResolvedValue({} as webpush.SendResult);

    await service.sendAlert(buildAlert());

    const [, payload, options] = mockedWebpush.sendNotification.mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual(
      expect.objectContaining({
        alertId: 'alert-1234-5678',
        title: 'AWAS BANJIR',
        url: '/peringatan/alert-1234-5678',
      }),
    );
    expect(options).toEqual(expect.objectContaining({ urgency: 'high' }));
  });

  it('deletes subscriptions the push service reports as gone (404/410) and records counts', async () => {
    const { service, subscriptionRepository, alertRepository } =
      buildService(VAPID_ENV);
    subscriptionRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilderMock([
        { id: 'ok', endpoint: 'https://push/ok', p256dh: 'k', auth: 'a' },
        { id: 'gone', endpoint: 'https://push/gone', p256dh: 'k', auth: 'a' },
        { id: 'flaky', endpoint: 'https://push/flaky', p256dh: 'k', auth: 'a' },
      ]),
    );
    mockedWebpush.sendNotification.mockImplementation(async (sub) => {
      if (sub.endpoint.endsWith('/gone'))
        throw Object.assign(new Error('Gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('/flaky'))
        throw Object.assign(new Error('Busy'), { statusCode: 503 });
      return {} as webpush.SendResult;
    });

    const result = await service.sendAlert(buildAlert());

    expect(result).toEqual({ sent: 1, failed: 2, removed: 1 });
    // `In([...])` is a FindOperator; its public `value` is the id list.
    expect(subscriptionRepository.delete.mock.calls[0][0].id.value).toEqual([
      'gone',
    ]);
    expect(alertRepository.update).toHaveBeenCalledWith(
      { id: 'alert-1234-5678' },
      { pushSentCount: 1, pushFailedCount: 2 },
    );
  });
});

describe('notificationBody', () => {
  it("carries the action, destination and the officer's message", () => {
    expect(
      notificationBody({
        action: 'Segera menuju Titik Kumpul A.',
        destinationName: 'Titik Kumpul A',
        message: 'Bawa pasokan makanan dan dokumen penting.',
      }),
    ).toBe(
      'Segera menuju Titik Kumpul A. Tujuan: Titik Kumpul A. Bawa pasokan makanan dan dokumen penting.',
    );
  });

  it('trims a long message to keep the push payload small', () => {
    const body = notificationBody({
      action: 'Mengungsi',
      destinationName: null,
      message: 'a'.repeat(1000),
    });
    expect(body.startsWith('Mengungsi. ')).toBe(true);
    expect(body.endsWith('…')).toBe(true);
    expect(body.length).toBeLessThan(420);
  });
});
