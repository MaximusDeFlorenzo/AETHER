import { BmkgAutoAlertService } from './bmkg-auto-alert.service';
import { PublicAlertHazard } from './public-alert.enums';
import { HazardType } from '../common/enums/domain.enum';

const NOW = new Date('2026-10-25T03:00:00Z');

function buildEvent(overrides: Record<string, unknown> = {}, details = {}) {
  return {
    id: 'event-1',
    source: 'bmkg_gempaterkini',
    latitude: -0.9,
    longitude: 119.8,
    locationLabel: '10 km BaratLaut DONGGALA-SULTENG',
    eventTime: new Date(NOW.getTime() - 5 * 60 * 1000),
    earthquakeDetails: {
      magnitude: 6.2,
      depthKm: 10,
      potentialTsunami: false,
      ...details,
    },
    ...overrides,
  };
}

function buildService(
  event: unknown,
  { alreadyAlerted = false, enabled = 'true' } = {},
) {
  const hazardEventRepository = { findOne: jest.fn().mockResolvedValue(event) };
  const geoService = {
    findDistrictsReachingPoint: jest.fn().mockResolvedValue([
      { id: 'd-1', name: 'Kab. Donggala', distanceKm: 12.4 },
      { id: 'd-2', name: 'Kota Palu', distanceKm: 38.9 },
    ]),
  };
  const publicAlertsService = {
    existsForHazardEvent: jest.fn().mockResolvedValue(alreadyAlerted),
    issueAutomatic: jest.fn().mockResolvedValue({}),
  };
  const config = { get: jest.fn().mockReturnValue(enabled) };
  const service = new BmkgAutoAlertService(
    config as never,
    hazardEventRepository as never,
    geoService as never,
    publicAlertsService as never,
  );
  return { service, geoService, publicAlertsService, hazardEventRepository };
}

describe('BmkgAutoAlertService', () => {
  it('alerts every district within the magnitude radius of a fresh BMKG quake', async () => {
    const { service, geoService, publicAlertsService } =
      buildService(buildEvent());

    await expect(service.relay('event-1', NOW)).resolves.toBe(2);

    // M6.2 → 50 × (6.2 − 4) = 110 km
    expect(geoService.findDistrictsReachingPoint).toHaveBeenCalledWith(
      -0.9,
      119.8,
      110_000,
    );
    expect(publicAlertsService.issueAutomatic).toHaveBeenCalledTimes(2);
    const first = publicAlertsService.issueAutomatic.mock.calls[0][0];
    expect(first).toMatchObject({
      hazard: PublicAlertHazard.EARTHQUAKE,
      title: 'Gempa M6,2',
      districtId: 'd-1',
      hazardEventId: 'event-1',
      expiresInHours: 3,
    });
    expect(first.message).toContain('12 km dari pusat Kab. Donggala');
    expect(first.sourceLabel).toContain('BMKG');
  });

  it('sends a tsunami alert over a wider radius when BMKG flags tsunami potential', async () => {
    const { service, geoService, publicAlertsService } = buildService(
      buildEvent({}, { magnitude: 7.4, potentialTsunami: true }),
    );

    await service.relay('event-1', NOW);

    expect(geoService.findDistrictsReachingPoint).toHaveBeenCalledWith(
      -0.9,
      119.8,
      300_000,
    );
    expect(publicAlertsService.issueAutomatic.mock.calls[0][0]).toMatchObject({
      hazard: PublicAlertHazard.TSUNAMI,
      title: 'Gempa M7,4 berpotensi tsunami',
      action: 'Jauhi pantai, segera ke tempat tinggi',
      expiresInHours: 6,
    });
  });

  it.each([
    [
      'an old quake from the feed backlog',
      buildEvent({ eventTime: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }),
    ],
    ['a non-BMKG (simulated) quake', buildEvent({ source: 'simulation' })],
    ['a quake below M5', buildEvent({}, { magnitude: 4.6 })],
    ['a missing event', null],
  ])('does not alert for %s', async (_label, event) => {
    const { service, publicAlertsService } = buildService(event);

    await expect(service.relay('event-1', NOW)).resolves.toBe(0);
    expect(publicAlertsService.issueAutomatic).not.toHaveBeenCalled();
  });

  it('never alerts twice for the same quake', async () => {
    const { service, publicAlertsService } = buildService(buildEvent(), {
      alreadyAlerted: true,
    });

    await expect(service.relay('event-1', NOW)).resolves.toBe(0);
    expect(publicAlertsService.issueAutomatic).not.toHaveBeenCalled();
  });

  it('ignores non-earthquake events and respects the kill switch', async () => {
    const quake = buildService(buildEvent(), { enabled: 'false' });
    await quake.service.handleHazardEventCreated({
      hazardEventId: 'event-1',
      hazardType: HazardType.EARTHQUAKE,
      affectedDistrictIds: [],
    });
    expect(quake.hazardEventRepository.findOne).not.toHaveBeenCalled();

    const flood = buildService(buildEvent());
    await flood.service.handleHazardEventCreated({
      hazardEventId: 'event-1',
      hazardType: HazardType.FLOOD,
      affectedDistrictIds: [],
    });
    expect(flood.hazardEventRepository.findOne).not.toHaveBeenCalled();
  });
});
