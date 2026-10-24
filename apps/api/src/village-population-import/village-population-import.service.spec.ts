import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { VillagePopulationImportService } from './village-population-import.service';
import {
  PopulationImportBatchStatus,
  PopulationImportRowResolutionAction,
  PopulationImportRowStatus,
  PopulationNumberFormat,
  PopulationPeriodStatus,
} from '../common/enums/domain.enum';

// A minimal fluent mock matching TypeORM's UpdateQueryBuilder chain, so
// tests can drive `confirmBatch`/`retryBatch`'s atomic
// `UPDATE ... WHERE status = ...` without a real database — this only
// proves the service issues the right conditional UPDATE and reacts
// correctly to `affected`, not that Postgres actually serializes two
// concurrent UPDATEs (that's what the live E2E concurrent-confirm test
// covers instead, against a real database).
function createUpdateQueryBuilderMock(affected: number) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['update', 'set', 'where', 'andWhere']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue({ affected, raw: [] });
  return qb;
}

describe('VillagePopulationImportService', () => {
  let batchRepository: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let rowRepository: Record<string, jest.Mock>;
  let villageRepository: Record<string, jest.Mock>;
  let storageService: { uploadObject: jest.Mock };
  let validationQueue: { add: jest.Mock };
  let importQueue: { add: jest.Mock };
  let service: VillagePopulationImportService;

  beforeEach(() => {
    batchRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'batch-1', ...v })),
    };
    rowRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (v) => v),
    };
    villageRepository = { findOne: jest.fn() };
    storageService = {
      uploadObject: jest.fn().mockResolvedValue('storage-key-1'),
    };
    validationQueue = { add: jest.fn().mockResolvedValue(undefined) };
    importQueue = { add: jest.fn().mockResolvedValue(undefined) };

    service = new VillagePopulationImportService(
      batchRepository as any,
      rowRepository as any,
      villageRepository as any,
      storageService as any,
      validationQueue as any,
      importQueue as any,
    );
  });

  describe('createBatch', () => {
    const baseParams = {
      file: {
        buffer: Buffer.from('a;b\n1;2'),
        originalname: 'test.csv',
        mimetype: 'text/csv',
      },
      hasHeaderRow: true,
      numberFormat: PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR,
      sourceName: 'Prodeskel',
      sourceReference: null,
      uploadedByUserId: 'user-1',
    };

    it('rejects a confirmed period with no year rather than silently defaulting one', async () => {
      await expect(
        service.createBatch({
          ...baseParams,
          periodStatus: PopulationPeriodStatus.CONFIRMED,
          periodYear: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageService.uploadObject).not.toHaveBeenCalled();
    });

    it('uploads the file, creates the batch as UPLOADED, and enqueues validation without waiting on it — never parses inline', async () => {
      const result = await service.createBatch({
        ...baseParams,
        periodStatus: PopulationPeriodStatus.UNKNOWN,
        periodYear: null,
      });

      expect(storageService.uploadObject).toHaveBeenCalledWith(
        'village-population-imports',
        baseParams.file.buffer,
        'text/csv',
      );
      expect(batchRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PopulationImportBatchStatus.UPLOADED,
        }),
      );
      // Deterministic id (not random) — a redelivered/duplicated add() for
      // the same batch is a BullMQ no-op, never a second validation job.
      expect(validationQueue.add).toHaveBeenCalledWith(
        'validate',
        { batchId: 'batch-1' },
        expect.objectContaining({ jobId: 'validate-batch-1' }),
      );
      expect(result.status).toBe(PopulationImportBatchStatus.UPLOADED);
    });
  });

  describe('confirmBatch', () => {
    it('enqueues the import job and returns the updated batch when the CAS update affects exactly one row', async () => {
      const qb = createUpdateQueryBuilderMock(1);
      batchRepository.createQueryBuilder.mockReturnValue(qb);
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.QUEUED,
      });

      const result = await service.confirmBatch('batch-1');

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: PopulationImportBatchStatus.QUEUED }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'status = :readyStatus',
        expect.objectContaining({
          readyStatus: PopulationImportBatchStatus.READY,
        }),
      );
      expect(importQueue.add).toHaveBeenCalledWith(
        'import',
        { batchId: 'batch-1' },
        expect.objectContaining({ jobId: 'import-batch-1' }),
      );
      expect(result.status).toBe(PopulationImportBatchStatus.QUEUED);
    });

    // The exact scenario a double-click or two concurrent confirm requests
    // produce: the second call's conditional UPDATE matches zero rows
    // because the first call already moved status away from READY.
    it('rejects with 409 and never enqueues a second import job when the CAS update affects zero rows', async () => {
      const qb = createUpdateQueryBuilderMock(0);
      batchRepository.createQueryBuilder.mockReturnValue(qb);
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.QUEUED, // already confirmed by the other call
      });

      await expect(service.confirmBatch('batch-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(importQueue.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the batch does not exist at all', async () => {
      const qb = createUpdateQueryBuilderMock(0);
      batchRepository.createQueryBuilder.mockReturnValue(qb);
      batchRepository.findOne.mockResolvedValue(null);

      await expect(service.confirmBatch('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('retryBatch', () => {
    it('resumes validation (not import) when the batch never reached READY', async () => {
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.FAILED,
        readyAt: null,
      });
      const qb = createUpdateQueryBuilderMock(1);
      batchRepository.createQueryBuilder.mockReturnValue(qb);

      await service.retryBatch('batch-1');

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PopulationImportBatchStatus.UPLOADED,
        }),
      );
      expect(validationQueue.add).toHaveBeenCalled();
      expect(importQueue.add).not.toHaveBeenCalled();
    });

    it('resumes import (not validation) when the batch had already reached READY', async () => {
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.FAILED,
        readyAt: new Date('2026-01-01'),
      });
      const qb = createUpdateQueryBuilderMock(1);
      batchRepository.createQueryBuilder.mockReturnValue(qb);

      await service.retryBatch('batch-1');

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: PopulationImportBatchStatus.QUEUED }),
      );
      expect(importQueue.add).toHaveBeenCalled();
      expect(validationQueue.add).not.toHaveBeenCalled();
    });

    it('rejects a batch that is not FAILED — retry is only for a batch that actually stopped', async () => {
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.IMPORTING,
        readyAt: new Date('2026-01-01'),
      });

      await expect(service.retryBatch('batch-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(validationQueue.add).not.toHaveBeenCalled();
      expect(importQueue.add).not.toHaveBeenCalled();
    });

    // Two concurrent retry calls on the same FAILED batch: the second
    // one's CAS (`WHERE status = 'failed'`) matches zero rows because the
    // first already moved it away from FAILED — must not enqueue twice.
    it('rejects with 409 when the CAS update affects zero rows (concurrent retry)', async () => {
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.FAILED,
        readyAt: null,
      });
      const qb = createUpdateQueryBuilderMock(0);
      batchRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(service.retryBatch('batch-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(validationQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('resolveRow', () => {
    const readyBatch = {
      id: 'batch-1',
      status: PopulationImportBatchStatus.READY,
    };

    it('rejects when the batch is not READY — manual resolution only happens before confirm', async () => {
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.IMPORTING,
      });
      await expect(
        service.resolveRow(
          'batch-1',
          'row-1',
          { action: PopulationImportRowResolutionAction.ACCEPTED },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(rowRepository.findOne).not.toHaveBeenCalled();
    });

    it('rejects resolving a row that is not in a resolvable status (e.g. already VALID)', async () => {
      batchRepository.findOne.mockResolvedValue(readyBatch);
      rowRepository.findOne.mockResolvedValue({
        id: 'row-1',
        status: PopulationImportRowStatus.VALID,
        messages: [],
      });
      await expect(
        service.resolveRow(
          'batch-1',
          'row-1',
          { action: PopulationImportRowResolutionAction.ACCEPTED },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('HIERARCHY_MISMATCH + ACCEPTED: flips to VALID using the existing code match, no villageId needed', async () => {
      batchRepository.findOne.mockResolvedValue(readyBatch);
      batchRepository.createQueryBuilder.mockReturnValue(
        createUpdateQueryBuilderMock(1),
      );
      rowRepository.findOne.mockResolvedValue({
        id: 'row-1',
        status: PopulationImportRowStatus.HIERARCHY_MISMATCH,
        messages: [],
      });

      const result = await service.resolveRow(
        'batch-1',
        'row-1',
        {
          action: PopulationImportRowResolutionAction.ACCEPTED,
          note: 'cek manual, sama tempat',
        },
        'user-1',
      );

      expect(result.status).toBe(PopulationImportRowStatus.VALID);
      expect(result.resolutionAction).toBe(
        PopulationImportRowResolutionAction.ACCEPTED,
      );
      expect(result.resolvedBy).toEqual({ id: 'user-1' });
    });

    it('HIERARCHY_MISMATCH + ACCEPTED rejects a villageId override — that flow only confirms the existing match', async () => {
      batchRepository.findOne.mockResolvedValue(readyBatch);
      rowRepository.findOne.mockResolvedValue({
        id: 'row-1',
        status: PopulationImportRowStatus.HIERARCHY_MISMATCH,
        messages: [],
      });
      await expect(
        service.resolveRow(
          'batch-1',
          'row-1',
          {
            action: PopulationImportRowResolutionAction.ACCEPTED,
            villageId: 'village-9',
          },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('REGION_NOT_FOUND + ACCEPTED requires a villageId and fails if that village does not exist', async () => {
      batchRepository.findOne.mockResolvedValue(readyBatch);
      rowRepository.findOne.mockResolvedValue({
        id: 'row-1',
        status: PopulationImportRowStatus.REGION_NOT_FOUND,
        messages: [],
      });

      await expect(
        service.resolveRow(
          'batch-1',
          'row-1',
          { action: PopulationImportRowResolutionAction.ACCEPTED },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      villageRepository.findOne.mockResolvedValue(null);
      await expect(
        service.resolveRow(
          'batch-1',
          'row-1',
          {
            action: PopulationImportRowResolutionAction.ACCEPTED,
            villageId: 'village-9',
          },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('NEEDS_REVIEW + ACCEPTED with a real villageId sets matchedVillage/normalizedCode and flips to VALID', async () => {
      batchRepository.findOne.mockResolvedValue(readyBatch);
      batchRepository.createQueryBuilder.mockReturnValue(
        createUpdateQueryBuilderMock(1),
      );
      rowRepository.findOne.mockResolvedValue({
        id: 'row-1',
        status: PopulationImportRowStatus.NEEDS_REVIEW,
        messages: [],
      });
      villageRepository.findOne.mockResolvedValue({
        id: 'village-9',
        code: '11.01.01.1001',
      });

      const result = await service.resolveRow(
        'batch-1',
        'row-1',
        {
          action: PopulationImportRowResolutionAction.ACCEPTED,
          villageId: 'village-9',
        },
        'user-1',
      );

      expect(result.status).toBe(PopulationImportRowStatus.VALID);
      expect(result.matchedVillage).toEqual({
        id: 'village-9',
        code: '11.01.01.1001',
      });
      expect(result.normalizedCode).toBe('11.01.01.1001');
    });

    it('REJECTED leaves the row status unchanged but records the reviewer and reason', async () => {
      batchRepository.findOne.mockResolvedValue(readyBatch);
      rowRepository.findOne.mockResolvedValue({
        id: 'row-1',
        status: PopulationImportRowStatus.HIERARCHY_MISMATCH,
        messages: [],
      });

      const result = await service.resolveRow(
        'batch-1',
        'row-1',
        {
          action: PopulationImportRowResolutionAction.REJECTED,
          note: 'memang beda desa',
        },
        'user-1',
      );

      expect(result.status).toBe(PopulationImportRowStatus.HIERARCHY_MISMATCH);
      expect(result.resolutionAction).toBe(
        PopulationImportRowResolutionAction.REJECTED,
      );
      expect(batchRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
