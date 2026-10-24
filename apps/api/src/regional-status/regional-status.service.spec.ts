import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegionalStatusService } from './regional-status.service';
import { EmergencyPhase } from './emergency-phase.enum';
import { PublicAlertHazard } from '../public-alerts/public-alert.enums';
import type { RegionalEmergencyStatus } from '../database/entities';

function buildStatus(
  overrides: Partial<RegionalEmergencyStatus> = {},
): RegionalEmergencyStatus {
  return {
    id: 'status-1',
    district: { id: 'district-1', name: 'Kabupaten Barito Utara' },
    phase: EmergencyPhase.TANGGAP_DARURAT,
    hazard: PublicAlertHazard.WILDFIRE_SMOKE,
    startsOn: '2026-09-01',
    endsOn: '2026-10-01',
    decreeNumber: null,
    sourceLabel: 'Pemkab Barito Utara',
    sourceUrl: null,
    note: null,
    createdBy: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    endedAt: null,
    ...overrides,
  } as RegionalEmergencyStatus;
}

function buildService(
  existing: RegionalEmergencyStatus | null = buildStatus(),
) {
  let stored = existing;
  const statusRepository = {
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => {
      stored = { ...buildStatus(), ...input, id: input.id ?? 'status-new' };
      return stored;
    }),
    findOne: jest.fn(async () => stored),
  };
  const districtRepository = {
    findOne: jest.fn(async () => ({
      id: 'district-1',
      name: 'Kabupaten Barito Utara',
    })),
  };
  const service = new RegionalStatusService(
    statusRepository as never,
    districtRepository as never,
  );
  return { service, statusRepository, districtRepository };
}

describe('RegionalStatusService', () => {
  const createDto = {
    districtId: 'district-1',
    phase: EmergencyPhase.TANGGAP_DARURAT,
    hazard: PublicAlertHazard.WILDFIRE_SMOKE,
    startsOn: '2026-09-01',
    endsOn: '2026-10-15',
    sourceLabel: '  Pemkab Barito Utara ',
    decreeNumber: '  ',
  };

  it('creates a status with trimmed text and blank optionals as null', async () => {
    const { service, statusRepository } = buildService(null);
    await service.create(createDto, 'user-1');
    const saved = statusRepository.save.mock.calls[0][0];
    expect(saved.sourceLabel).toBe('Pemkab Barito Utara');
    expect(saved.decreeNumber).toBeNull();
    expect(saved.createdBy).toEqual({ id: 'user-1' });
  });

  it('rejects an end date before the start date', async () => {
    const { service } = buildService(null);
    await expect(
      service.create({ ...createDto, endsOn: '2026-08-31' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown district', async () => {
    const { service, districtRepository } = buildService(null);
    districtRepository.findOne.mockResolvedValueOnce(null as never);
    await expect(service.create(createDto, 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('extends a status by moving ends_on ("diperpanjang")', async () => {
    const { service } = buildService();
    const view = await service.update('status-1', { endsOn: '2026-10-15' });
    expect(view.endsOn).toBe('2026-10-15');
    expect(view.startsOn).toBe('2026-09-01');
  });

  it('rejects an extension that would end before it started', async () => {
    const { service } = buildService();
    await expect(
      service.update('status-1', { endsOn: '2026-08-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ends a status once and keeps the first end time', async () => {
    const endedAt = new Date('2026-10-02T00:00:00Z');
    const { service, statusRepository } = buildService(
      buildStatus({ endedAt }),
    );
    const view = await service.end('status-1');
    expect(view.endedAt).toBe(endedAt.toISOString());
    expect(statusRepository.save).not.toHaveBeenCalled();
  });
});
