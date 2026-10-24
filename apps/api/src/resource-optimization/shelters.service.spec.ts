import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResourceOptimizationService } from './resource-optimization.service';

function build(options: { districtExists?: boolean; existing?: object } = {}) {
  const stored = {
    id: 'shelter-1',
    name: 'Posko A',
    district: { id: 'district-1' },
    geom: { type: 'Point', coordinates: [110, -7] },
    capacity: 100,
    currentOccupancy: 0,
    isActive: true,
    ...options.existing,
  };
  const shelterRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(stored),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve({ id: 'shelter-1', ...v })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    manager: {
      exists: jest.fn().mockResolvedValue(options.districtExists ?? true),
    },
  };
  const service = new ResourceOptimizationService(
    {} as any,
    shelterRepository as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, shelterRepository, stored };
}

describe('ResourceOptimizationService shelters', () => {
  it('lists only active posko unless includeInactive is set', async () => {
    const { service, shelterRepository } = build();
    await service.findAllShelters({ district: 'district-1' });
    expect(shelterRepository.find.mock.calls[0][0].where).toEqual({
      district: { id: 'district-1' },
      isActive: true,
    });

    await service.findAllShelters({ includeInactive: true });
    expect(shelterRepository.find.mock.calls[1][0].where).toEqual({});
  });

  it('creates a posko as a GeoJSON point with optional details defaulted', async () => {
    const { service, shelterRepository } = build();
    await service.createShelter({
      districtId: 'district-1',
      name: '  Posko Balai Desa  ',
      latitude: -7.8,
      longitude: 110.37,
      capacity: 250,
      contactPhone: '0812',
    });
    expect(shelterRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Posko Balai Desa',
        geom: { type: 'Point', coordinates: [110.37, -7.8] },
        currentOccupancy: 0,
        contactPhone: '0812',
        address: null,
        isActive: true,
      }),
    );
  });

  it('rejects an unknown district', async () => {
    const { service } = build({ districtExists: false });
    await expect(
      service.createShelter({
        districtId: 'nope',
        name: 'X',
        latitude: 0,
        longitude: 110,
        capacity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates only the given fields and moves the point when both coordinates change', async () => {
    const { service, shelterRepository } = build();
    await service.updateShelter('shelter-1', {
      isActive: false,
      latitude: -6.2,
      longitude: 106.8,
    });
    const saved = shelterRepository.save.mock.calls[0][0];
    expect(saved.isActive).toBe(false);
    expect(saved.geom).toEqual({ type: 'Point', coordinates: [106.8, -6.2] });
    expect(saved.name).toBe('Posko A');
  });

  it('refuses to move the point with only one coordinate', async () => {
    const { service } = build();
    await expect(
      service.updateShelter('shelter-1', { latitude: -6.2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when deleting a missing posko', async () => {
    const { service, shelterRepository } = build();
    shelterRepository.delete.mockResolvedValue({ affected: 0 });
    await expect(service.deleteShelter('gone')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
