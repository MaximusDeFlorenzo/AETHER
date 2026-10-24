import { BadRequestException } from '@nestjs/common';
import { PublicFireController } from './public-fire.controller';

describe('PublicFireController', () => {
  const service = {
    getMap: jest.fn().mockResolvedValue({}),
    getPoints: jest.fn().mockResolvedValue({}),
  };
  const smokeService = { getLatest: jest.fn().mockResolvedValue({}) };
  const controller = new PublicFireController(
    service as never,
    smokeService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('passes the citizen location through as `near`', async () => {
    await controller.getHotspots({ hours: 24, limit: 300, lat: -2, lng: 114 });
    expect(service.getMap).toHaveBeenCalledWith({
      hours: 24,
      limit: 300,
      near: { latitude: -2, longitude: 114 },
    });
  });

  it('rejects half a location', () => {
    expect(() =>
      controller.getHotspots({ hours: 24, limit: 300, lat: -2 }),
    ).toThrow(BadRequestException);
  });

  it('rejects inverted or oversized viewports', () => {
    expect(() =>
      controller.getHotspotPoints({ hours: 24, bbox: '115,-3,113,-1' }),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.getHotspotPoints({ hours: 24, bbox: '100,-10,115,0' }),
    ).toThrow(BadRequestException);
  });

  it('queries a valid viewport', async () => {
    await controller.getHotspotPoints({ hours: 6, bbox: '113,-3,115,-1' });
    expect(service.getPoints).toHaveBeenCalledWith(6, [113, -3, 115, -1]);
  });

  it('passes smoke display hours and citizen location', async () => {
    await controller.getSmoke({ hours: 3, lat: -0.5, lng: 101.4 });
    expect(smokeService.getLatest).toHaveBeenCalledWith(3, {
      latitude: -0.5,
      longitude: 101.4,
    });
    await controller.getSmoke({ hours: 6 });
    expect(smokeService.getLatest).toHaveBeenLastCalledWith(6, undefined);
  });
});
