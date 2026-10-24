import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { RoleName } from '../common/enums/roles.enum';
import {
  GroundReport,
  GroundReportEvidence,
  GroundReportStatusChange,
} from '../database/entities';
import {
  GroundObservationType,
  GroundReportStatus,
} from './ground-report.enums';
import { GroundReportsService } from './ground-reports.service';
import type { CreateGroundReportDto } from './dto/create-ground-report.dto';

const NOW = new Date('2026-10-13T08:00:00Z');

const reporter = {
  id: 'user-reporter',
  email: 'r@example.org',
  fullName: 'Reporter',
  role: RoleName.FIELD_REPORTER,
};
const otherReporter = { ...reporter, id: 'user-other' };
const analyst = { ...reporter, id: 'user-analyst', role: RoleName.ANALYST };
const operator = {
  ...reporter,
  id: 'user-operator',
  role: RoleName.AGENCY_OPERATOR,
};

function jpegWithExif(): Buffer {
  const app1Payload = Buffer.concat([
    Buffer.from('Exif\0\0', 'latin1'),
    Buffer.from('II*\0\x08\0\0\0\0\0', 'latin1'),
  ]);
  const app1 = Buffer.from([0xff, 0xe1, 0, 0]);
  app1.writeUInt16BE(app1Payload.length + 2, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    app1Payload,
    Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function file(buffer: Buffer, originalname = 'photo.jpg') {
  return {
    buffer,
    originalname,
    mimetype: 'image/jpeg',
  } as Express.Multer.File;
}

function dto(
  overrides: Partial<CreateGroundReportDto> = {},
): CreateGroundReportDto {
  return {
    observationType: GroundObservationType.FLOODWATER,
    latitude: -6.2,
    longitude: 106.8,
    observedAt: '2026-10-13T14:30:00+07:00',
    description: 'Air setinggi lutut di jalan utama',
    waterDepthCm: 50,
    ...overrides,
  };
}

function storedReport(overrides: Partial<GroundReport> = {}): GroundReport {
  return {
    id: 'report-1',
    observationType: GroundObservationType.FLOODWATER,
    status: GroundReportStatus.UNDER_REVIEW,
    latitude: -6.2,
    longitude: 106.8,
    nearestDistrict: { id: 'district-1', name: 'Kota Jakarta Pusat' },
    nearestDistrictId: 'district-1',
    observedAt: new Date('2026-10-13T07:30:00Z'),
    submittedAt: new Date('2026-10-13T07:35:00Z'),
    description: 'Air setinggi lutut',
    waterDepthCm: 50,
    reporterSeverity: null,
    reporter: { id: reporter.id, fullName: 'Reporter', email: 'r@example.org' },
    reporterId: reporter.id,
    duplicateOfId: null,
    trainingEligible: false,
    lastReviewedById: null,
    lastReviewedAt: null,
    updatedAt: new Date('2026-10-13T07:35:00Z'),
    evidence: [
      {
        id: 'ev-1',
        storageKey: 'ground-reports/k1',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
        exif: { gps: { latitude: -6.2, longitude: 106.8 } },
        cvHint: null,
        duplicateOfEvidenceId: null,
        uploadedById: reporter.id,
        createdAt: new Date('2026-10-13T07:35:00Z'),
      },
    ],
    statusHistory: [
      {
        id: 'h-1',
        reportId: 'report-1',
        fromStatus: null,
        toStatus: GroundReportStatus.SUBMITTED,
        actorUserId: reporter.id,
        reason: null,
        notes: null,
        createdAt: new Date('2026-10-13T07:35:00Z'),
      },
      {
        id: 'h-2',
        reportId: 'report-1',
        fromStatus: GroundReportStatus.SUBMITTED,
        toStatus: GroundReportStatus.UNDER_REVIEW,
        actorUserId: analyst.id,
        reason: null,
        notes: 'internal: check CCTV',
        createdAt: new Date('2026-10-13T07:40:00Z'),
      },
    ],
    ...overrides,
  } as unknown as GroundReport;
}

function build(options: { affected?: number; recentCount?: number } = {}) {
  const created: Array<{ entity: unknown; input: Record<string, unknown> }> =
    [];
  const updateQb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: options.affected ?? 1 }),
  };
  const manager = {
    create: jest.fn((entity: unknown, input: Record<string, unknown>) => {
      created.push({ entity, input });
      return { ...input };
    }),
    save: jest.fn(async (row: Record<string, unknown>) => ({
      id: 'report-1',
      ...row,
    })),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => updateQb),
  };
  const reportRepository = {
    findOne: jest.fn().mockResolvedValue(storedReport()),
    count: jest.fn().mockResolvedValue(options.recentCount ?? 0),
    find: jest.fn().mockResolvedValue([]),
    query: jest.fn().mockResolvedValue([{ id: 'district-1' }]),
  };
  const evidenceRepository = { count: jest.fn().mockResolvedValue(1) };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: typeof manager) => unknown) =>
      cb(manager),
    ),
  };
  const storageService = {
    uploadObject: jest.fn().mockResolvedValue('ground-reports/new-key'),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/x'),
  };
  const cvEngineClient = {
    detectCv: jest.fn().mockRejectedValue(new Error('engine down')),
  };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(undefined) };

  const service = new GroundReportsService(
    reportRepository as any,
    evidenceRepository as any,
    dataSource as any,
    storageService as any,
    cvEngineClient as any,
    auditService as any,
    config as any,
  );
  return {
    service,
    created,
    manager,
    updateQb,
    reportRepository,
    evidenceRepository,
    storageService,
    auditService,
  };
}

describe('GroundReportsService.submit', () => {
  it.each([
    ['outside Indonesia', dto({ latitude: 40.7, longitude: -74 })],
    [
      'observed in the future',
      dto({ observedAt: '2026-10-13T18:00:00+07:00' }),
    ],
    [
      'observed > 30 days ago',
      dto({ observedAt: '2026-08-01T10:00:00+07:00' }),
    ],
    [
      'water depth on a smoke report',
      dto({ observationType: GroundObservationType.SMOKE, waterDepthCm: 20 }),
    ],
  ])('rejects a report %s without storing anything', async (_label, input) => {
    const { service, storageService, manager } = build();
    await expect(
      service.submit(input, [file(jpegWithExif())], reporter, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageService.uploadObject).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects a file whose bytes are not an image, whatever its declared type', async () => {
    const { service, storageService } = build();
    await expect(
      service.submit(
        dto(),
        [file(Buffer.from('<?php system($_GET[1]);'), 'x.jpg')],
        reporter,
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageService.uploadObject).not.toHaveBeenCalled();
  });

  it('requires at least one image', async () => {
    const { service } = build();
    await expect(
      service.submit(dto(), [], reporter, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 429 once the hourly limit is reached', async () => {
    const { service } = build({ recentCount: 10 });
    const error = await service
      .submit(dto(), [file(jpegWithExif())], reporter, NOW)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it('stores a metadata-stripped copy, the history row and an audit entry; CV outage does not block', async () => {
    const { service, storageService, created, auditService } = build();
    await service.submit(dto(), [file(jpegWithExif())], reporter, NOW);

    const uploaded: Buffer = storageService.uploadObject.mock.calls[0][1];
    expect(uploaded.toString('latin1')).not.toContain('Exif');

    const report = created.find((c) => c.entity === GroundReport)!.input;
    expect(report).toMatchObject({
      status: GroundReportStatus.SUBMITTED,
      reporterId: reporter.id,
      nearestDistrictId: 'district-1',
      duplicateOfId: null,
    });
    expect((report.observedAt as Date).toISOString()).toBe(
      '2026-10-13T07:30:00.000Z',
    );
    expect(report).not.toHaveProperty('trainingEligible');

    const evidence = created.find(
      (c) => c.entity === GroundReportEvidence,
    )!.input;
    expect(evidence).toMatchObject({ mimeType: 'image/jpeg', cvHint: null });
    expect(evidence.sha256).toMatch(/^[0-9a-f]{64}$/);

    const history = created.find(
      (c) => c.entity === GroundReportStatusChange,
    )!.input;
    expect(history).toMatchObject({
      fromStatus: null,
      toStatus: GroundReportStatus.SUBMITTED,
      actorUserId: reporter.id,
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ground_reports.submit' }),
    );
  });

  it('flags (not drops) a resend of the same observation', async () => {
    const { service, reportRepository, created } = build();
    reportRepository.find.mockResolvedValue([
      {
        id: 'earlier',
        observationType: GroundObservationType.FLOODWATER,
        latitude: -6.2001,
        longitude: 106.8,
        submittedAt: new Date('2026-10-13T07:55:00Z'),
      },
    ]);
    await service.submit(dto(), [file(jpegWithExif())], reporter, NOW);
    expect(
      created.find((c) => c.entity === GroundReport)!.input.duplicateOfId,
    ).toBe('earlier');
  });

  it('marks a recycled photo already attached to another report', async () => {
    const { service, manager, created } = build();
    manager.findOne.mockResolvedValue({ id: 'old-evidence' });
    await service.submit(dto(), [file(jpegWithExif())], reporter, NOW);
    expect(
      created.find((c) => c.entity === GroundReportEvidence)!.input
        .duplicateOfEvidenceId,
    ).toBe('old-evidence');
  });

  it('deletes uploaded objects when the database write fails', async () => {
    const { service, manager, storageService } = build();
    manager.save.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.submit(dto(), [file(jpegWithExif())], reporter, NOW),
    ).rejects.toThrow('db down');
    expect(storageService.deleteObject).toHaveBeenCalledWith(
      'ground-reports/new-key',
    );
  });
});

describe('GroundReportsService.transition', () => {
  it('forbids an analyst from verifying', async () => {
    const { service, manager } = build();
    await expect(
      service.transition(
        'report-1',
        { to: GroundReportStatus.VERIFIED },
        analyst,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('forbids a field reporter from any status change', async () => {
    const { service } = build();
    await expect(
      service.transition(
        'report-1',
        { to: GroundReportStatus.REJECTED, reason: 'mine' },
        reporter,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a reason to reject', async () => {
    const { service } = build();
    await expect(
      service.transition(
        'report-1',
        { to: GroundReportStatus.REJECTED },
        operator,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an invalid move with 409', async () => {
    const { service, reportRepository } = build();
    reportRepository.findOne.mockResolvedValue(
      storedReport({ status: GroundReportStatus.SUBMITTED }),
    );
    await expect(
      service.transition(
        'report-1',
        { to: GroundReportStatus.VERIFIED },
        operator,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('loses a concurrent race with 409 and writes no history', async () => {
    const { service, created } = build({ affected: 0 });
    await expect(
      service.transition(
        'report-1',
        { to: GroundReportStatus.VERIFIED },
        operator,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(created.some((c) => c.entity === GroundReportStatusChange)).toBe(
      false,
    );
  });

  it('verifies with a CAS update, one history row and one audit entry — and nothing else', async () => {
    const { service, created, updateQb, auditService, manager } = build();
    await service.transition(
      'report-1',
      { to: GroundReportStatus.VERIFIED, notes: 'matches BPBD post' },
      operator,
    );

    expect(updateQb.update).toHaveBeenCalledWith(GroundReport);
    expect(updateQb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: GroundReportStatus.VERIFIED,
        lastReviewedById: operator.id,
      }),
    );
    expect(updateQb.set.mock.calls[0][0]).not.toHaveProperty(
      'trainingEligible',
    );
    expect(updateQb.where).toHaveBeenCalledWith('id = :id AND status = :from', {
      id: 'report-1',
      from: GroundReportStatus.UNDER_REVIEW,
    });
    // The only rows written are the status-change row; no hazard event,
    // notification or model input is created by verification.
    expect(created.map((c) => c.entity)).toEqual([GroundReportStatusChange]);
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ground_reports.transition',
        metadata: { from: 'under_review', to: 'verified' },
      }),
    );
  });

  it('audits a reopen distinctly', async () => {
    const { service, reportRepository, auditService } = build();
    reportRepository.findOne.mockResolvedValue(
      storedReport({ status: GroundReportStatus.REJECTED }),
    );
    await service.transition(
      'report-1',
      { to: GroundReportStatus.UNDER_REVIEW, reason: 'BPBD confirmed later' },
      operator,
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ground_reports.reopen' }),
    );
  });
});

describe('GroundReportsService.addEvidence', () => {
  it('hides other reporters’ reports', async () => {
    const { service } = build();
    await expect(
      service.addEvidence('report-1', [file(jpegWithExif())], otherReporter),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses evidence while the report is under review', async () => {
    const { service } = build();
    await expect(
      service.addEvidence('report-1', [file(jpegWithExif())], reporter),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers an evidence request by sending the report back to review', async () => {
    const { service, reportRepository, created } = build();
    reportRepository.findOne.mockResolvedValue(
      storedReport({ status: GroundReportStatus.NEEDS_MORE_EVIDENCE }),
    );
    await service.addEvidence('report-1', [file(jpegWithExif())], reporter);
    const history = created.find(
      (c) => c.entity === GroundReportStatusChange,
    )!.input;
    expect(history).toMatchObject({
      fromStatus: GroundReportStatus.NEEDS_MORE_EVIDENCE,
      toStatus: GroundReportStatus.UNDER_REVIEW,
      actorUserId: reporter.id,
    });
  });
});

describe('GroundReportsService views', () => {
  it('shows a reporter their own report without reviewer identities, notes or EXIF', async () => {
    const { service } = build();
    const view = (await service.findOne('report-1', reporter)) as Record<
      string,
      any
    >;
    expect(view).not.toHaveProperty('reporter');
    expect(view).not.toHaveProperty('lastReviewedById');
    expect(view).not.toHaveProperty('trainingEligible');
    expect(view.evidence[0]).not.toHaveProperty('exif');
    expect(view.evidence[0]).not.toHaveProperty('sha256');
    expect(view.statusHistory[1]).not.toHaveProperty('actorUserId');
    expect(view.statusHistory[1]).not.toHaveProperty('notes');
    expect(JSON.stringify(view)).not.toContain('internal: check CCTV');
  });

  it('hides another reporter’s report as not found', async () => {
    const { service } = build();
    await expect(
      service.findOne('report-1', otherReporter),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives reviewers the reporter, notes and EXIF, but never the reporter email', async () => {
    const { service } = build();
    const view = (await service.findOne('report-1', analyst)) as Record<
      string,
      any
    >;
    expect(view.reporter).toEqual({ id: reporter.id, fullName: 'Reporter' });
    expect(view.statusHistory[1].notes).toBe('internal: check CCTV');
    expect(view.evidence[0].exif).toBeDefined();
    expect(view.trainingEligible).toBe(false);
    expect(JSON.stringify(view)).not.toContain('r@example.org');
  });
});
