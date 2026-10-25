import { NotFoundException } from '@nestjs/common';
import { PublicAlertsService } from './public-alerts.service';
import {
  PublicAlertHazard,
  PublicAlertResponseStatus,
  PublicAlertStatus,
} from './public-alert.enums';
import type { PublicAlert } from '../database/entities';

function createQueryBuilderMock(result: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(result);
  return qb;
}

function buildAlert(overrides: Partial<PublicAlert> = {}): PublicAlert {
  return {
    id: 'alert-1',
    hazard: PublicAlertHazard.TSUNAMI,
    status: PublicAlertStatus.ACTIVE,
    title: 'Peringatan dini tsunami',
    action: 'Lari ke tempat tinggi sekarang',
    message: 'Gempa kuat di laut.',
    destinationName: null,
    destinationLatitude: null,
    destinationLongitude: null,
    avoidText: null,
    sourceLabel: 'BMKG',
    district: { id: 'district-1', name: 'Kab. Pesisir' },
    subdistrict: null,
    village: null,
    createdAt: new Date('2026-09-29T10:00:00Z'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    endedAt: null,
    ...overrides,
  } as PublicAlert;
}

function buildService() {
  const alertRepository = {
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => ({
      id: 'alert-new',
      createdAt: new Date(),
      endedAt: null,
      ...input,
    })),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const responseRepository = {
    findOne: jest.fn(),
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => input),
  };
  const areaResolver = {
    resolve: jest.fn().mockResolvedValue({
      district: { id: 'district-1', name: 'Kab. Pesisir' },
      subdistrict: null,
      village: null,
    }),
  };
  const webPushService = {
    sendAlert: jest.fn().mockResolvedValue({ sent: 0, failed: 0, removed: 0 }),
  };
  const eventEmitter = { emit: jest.fn() };
  const service = new PublicAlertsService(
    alertRepository as any,
    responseRepository as any,
    areaResolver as any,
    webPushService as any,
    eventEmitter as any,
  );
  return {
    service,
    eventEmitter,
    alertRepository,
    responseRepository,
    areaResolver,
    webPushService,
  };
}

describe('PublicAlertsService.create', () => {
  it('validates the area, sets an expiry and fans out push without awaiting it', async () => {
    const { service, areaResolver, webPushService, alertRepository } =
      buildService();
    const before = Date.now();

    const view = await service.create(
      {
        hazard: PublicAlertHazard.TSUNAMI,
        title: ' Peringatan dini tsunami ',
        action: 'Lari ke tempat tinggi sekarang',
        message: 'Gempa kuat di laut.',
        sourceLabel: 'BMKG',
        districtId: 'district-1',
        expiresInHours: 6,
      },
      'user-1',
    );

    expect(areaResolver.resolve).toHaveBeenCalledWith(
      'district-1',
      undefined,
      undefined,
    );
    const saved = alertRepository.save.mock.calls[0][0];
    expect(saved.title).toBe('Peringatan dini tsunami');
    expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 6 * 60 * 60 * 1000,
    );
    expect(webPushService.sendAlert).toHaveBeenCalledTimes(1);
    expect(view.isActive).toBe(true);
  });
});

describe('PublicAlertsService.findActiveForArea', () => {
  it('only narrows by subdistrict/village when the viewer supplied them', async () => {
    const { service, alertRepository } = buildService();
    const qb = createQueryBuilderMock([buildAlert()]);
    alertRepository.createQueryBuilder.mockReturnValue(qb);

    const districtOnly = await service.findActiveForArea({
      district: 'district-1',
    });

    expect(districtOnly).toHaveLength(1);
    expect(qb.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('subdistrict_id'),
      expect.anything(),
    );

    const qb2 = createQueryBuilderMock([]);
    alertRepository.createQueryBuilder.mockReturnValue(qb2);
    await service.findActiveForArea({
      district: 'district-1',
      subdistrict: 'sub-1',
      village: 'v-1',
    });

    expect(qb2.andWhere).toHaveBeenCalledWith(
      '(alert.subdistrict_id IS NULL OR alert.subdistrict_id = :subdistrict)',
      { subdistrict: 'sub-1' },
    );
    expect(qb2.andWhere).toHaveBeenCalledWith(
      '(alert.village_id IS NULL OR alert.village_id = :village)',
      { village: 'v-1' },
    );
  });
});

describe('PublicAlertsService.isActive', () => {
  it('treats an expired alert as inactive even if nobody ended it', () => {
    expect(
      PublicAlertsService.isActive(
        buildAlert({ expiresAt: new Date(Date.now() - 1000) }),
      ),
    ).toBe(false);
  });

  it('treats an ended alert as inactive before its expiry', () => {
    expect(
      PublicAlertsService.isActive(
        buildAlert({ status: PublicAlertStatus.ENDED }),
      ),
    ).toBe(false);
  });
});

describe('PublicAlertsService.respond', () => {
  it('overwrites the same device’s earlier answer instead of adding a second row', async () => {
    const { service, alertRepository, responseRepository } = buildService();
    alertRepository.findOne.mockResolvedValue(buildAlert());
    const earlier = {
      id: 'resp-1',
      deviceId: 'device-1',
      status: PublicAlertResponseStatus.NEEDS_HELP,
      latitude: -6.9,
      longitude: 106.8,
    };
    responseRepository.findOne.mockResolvedValue(earlier);

    await service.respond('alert-1', {
      deviceId: 'device-1',
      status: PublicAlertResponseStatus.SAFE,
    });

    expect(responseRepository.create).not.toHaveBeenCalled();
    expect(responseRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'resp-1',
        status: PublicAlertResponseStatus.SAFE,
        // A later "safe" without coordinates keeps the location shared earlier.
        latitude: -6.9,
        longitude: 106.8,
      }),
    );
  });

  it('notifies officers on a new help request, but not on later location updates', async () => {
    const { service, alertRepository, responseRepository, eventEmitter } =
      buildService();
    alertRepository.findOne.mockResolvedValue(buildAlert());
    responseRepository.findOne.mockResolvedValueOnce(null);
    responseRepository.create.mockImplementation((row: object) => ({
      latitude: null,
      longitude: null,
      ...row,
    }));

    await service.respond('alert-1', {
      deviceId: 'device-2',
      status: PublicAlertResponseStatus.NEEDS_HELP,
      latitude: -6.9,
      longitude: 106.8,
      peopleCount: 4,
      note: 'Ada lansia',
    });
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(responseRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ peopleCount: 4, note: 'Ada lansia' }),
    );

    responseRepository.findOne.mockResolvedValueOnce({
      id: 'resp-2',
      deviceId: 'device-2',
      status: PublicAlertResponseStatus.NEEDS_HELP,
      latitude: -6.9,
      longitude: 106.8,
      peopleCount: 4,
      note: 'Ada lansia',
    });
    await service.respond('alert-1', {
      deviceId: 'device-2',
      status: PublicAlertResponseStatus.NEEDS_HELP,
      latitude: -6.91,
      longitude: 106.81,
    });
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    // Location-only update keeps the details given earlier.
    expect(responseRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        latitude: -6.91,
        peopleCount: 4,
        note: 'Ada lansia',
      }),
    );
  });

  it('404s for an unknown alert', async () => {
    const { service, alertRepository } = buildService();
    alertRepository.findOne.mockResolvedValue(null);

    await expect(
      service.respond('missing', {
        deviceId: 'd',
        status: PublicAlertResponseStatus.SAFE,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
