import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { stringify } from 'csv-stringify/sync';
import {
  User,
  Village,
  VillagePopulationImportBatch,
  VillagePopulationImportRow,
} from '../database/entities';
import {
  PopulationImportBatchStatus,
  PopulationImportRowResolutionAction,
  PopulationImportRowStatus,
  PopulationNumberFormat,
  PopulationPeriodStatus,
} from '../common/enums/domain.enum';
import { StorageService } from '../storage/storage.service';
import {
  VILLAGE_POPULATION_CONFIRM_QUEUE,
  VILLAGE_POPULATION_VALIDATION_QUEUE,
} from '../queue/queue.module';
import type { ValidationJobPayload } from './processors/validation.processor';
import type { ImportJobPayload } from './processors/import.processor';
import type { Paginated } from '../geo/geo.service';

// Sized for a realistic ~100k-row file (12 `;`-delimited columns, quoted
// text fields) plus headroom — see README-worker.md for the measured file
// size of the 100k-row test fixture this was calibrated against.
const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB
const ERROR_REPORT_PAGE_SIZE = 5000;
const ROWS_NOT_WRITTEN = new Set<PopulationImportRowStatus>([
  PopulationImportRowStatus.DUPLICATE_IN_FILE,
  PopulationImportRowStatus.UNCHANGED,
  PopulationImportRowStatus.CONFLICT,
  PopulationImportRowStatus.INVALID,
  PopulationImportRowStatus.REGION_NOT_FOUND,
  PopulationImportRowStatus.HIERARCHY_MISMATCH,
  PopulationImportRowStatus.NEEDS_REVIEW,
  PopulationImportRowStatus.SKIPPED,
]);

// `attempts` gives BullMQ's own retry/backoff a chance at transient
// failures (DB hiccup, storage blip) before either processor's
// `@OnWorkerEvent('failed')` handler marks the batch FAILED for good — see
// validation.processor.ts / import.processor.ts. `removeOnFail: false`
// keeps a failed job's data around for inspection (jobId is stored on the
// batch row for exactly this).
const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false as const,
};

// Rows a human can actually act on via resolveRow — the three statuses
// where a code was present-but-unconfirmed or absent-but-candidate-found;
// deliberately excludes INVALID (a field-level data defect, not a
// region-matching ambiguity — resolving "the wrong real-world village" is
// a different problem from "this number doesn't parse").
const RESOLVABLE_ROW_STATUSES = new Set<PopulationImportRowStatus>([
  PopulationImportRowStatus.HIERARCHY_MISMATCH,
  PopulationImportRowStatus.REGION_NOT_FOUND,
  PopulationImportRowStatus.NEEDS_REVIEW,
]);

export interface ResolveRowParams {
  action: PopulationImportRowResolutionAction;
  villageId?: string;
  note?: string;
}

export interface CreateImportBatchParams {
  file: { buffer: Buffer; originalname: string; mimetype: string };
  hasHeaderRow: boolean;
  numberFormat: PopulationNumberFormat;
  sourceName: string;
  sourceReference: string | null;
  periodStatus: PopulationPeriodStatus;
  periodYear: number | null;
  uploadedByUserId: string;
}

@Injectable()
export class VillagePopulationImportService {
  private readonly logger = new Logger(VillagePopulationImportService.name);

  constructor(
    @InjectRepository(VillagePopulationImportBatch)
    private readonly batchRepository: Repository<VillagePopulationImportBatch>,
    @InjectRepository(VillagePopulationImportRow)
    private readonly rowRepository: Repository<VillagePopulationImportRow>,
    @InjectRepository(Village)
    private readonly villageRepository: Repository<Village>,
    private readonly storageService: StorageService,
    @InjectQueue(VILLAGE_POPULATION_VALIDATION_QUEUE)
    private readonly validationQueue: Queue<ValidationJobPayload>,
    @InjectQueue(VILLAGE_POPULATION_CONFIRM_QUEUE)
    private readonly importQueue: Queue<ImportJobPayload>,
  ) {}

  static readonly MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;

  /**
   * Uploads the file to durable storage, creates the batch row (status
   * UPLOADED), and enqueues a validation job — then returns immediately.
   * Never parses the file inline: a 100k-row file must not block this HTTP
   * request. `ValidationProcessor` does all parsing/matching/persisting.
   */
  async createBatch(
    params: CreateImportBatchParams,
  ): Promise<VillagePopulationImportBatch> {
    if (
      params.periodStatus === PopulationPeriodStatus.CONFIRMED &&
      params.periodYear == null
    ) {
      throw new BadRequestException(
        'periodYear wajib diisi ketika periodStatus = confirmed',
      );
    }

    const checksum = createHash('sha256')
      .update(params.file.buffer)
      .digest('hex');
    const storageKey = await this.storageService.uploadObject(
      'village-population-imports',
      params.file.buffer,
      'text/csv',
    );

    let batch = this.batchRepository.create({
      fileName: params.file.originalname,
      fileChecksumSha256: checksum,
      fileSizeBytes: params.file.buffer.byteLength,
      storageKey,
      uploadedBy: { id: params.uploadedByUserId } as never,
      hasHeaderRow: params.hasHeaderRow,
      numberFormat: params.numberFormat,
      sourceName: params.sourceName,
      sourceReference: params.sourceReference,
      periodStatus: params.periodStatus,
      periodYear: params.periodYear,
      status: PopulationImportBatchStatus.UPLOADED,
    });
    batch = await this.batchRepository.save(batch);

    // Deterministic id (not a random one) — a second add() with the same
    // id is a BullMQ no-op rather than a duplicate job, a second layer of
    // defense behind this being the only code path that ever enqueues a
    // batch's first validation job.
    const jobId = `validate-${batch.id}`;
    await this.validationQueue.add(
      'validate',
      { batchId: batch.id },
      { ...JOB_OPTS, jobId },
    );
    batch.validationJobId = jobId;
    return this.batchRepository.save(batch);
  }

  async getBatch(id: string): Promise<VillagePopulationImportBatch> {
    const batch = await this.batchRepository.findOne({
      where: { id },
      relations: { uploadedBy: true },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    // `User` has no `@Exclude()` on `passwordHash` and this app has no
    // global `ClassSerializerInterceptor` (verified — a pre-existing,
    // app-wide gap, not introduced here and out of this feature's scope
    // to fix everywhere), so loading the `uploadedBy` relation and
    // returning it as-is would leak the bcrypt hash straight into this
    // endpoint's JSON response — found live in the 100k-row e2e test.
    // `confirmBatch`/`retryBatch` both return through this method, so
    // fixing it here covers every response path that includes `uploadedBy`.
    if (batch.uploadedBy) {
      delete (batch.uploadedBy as { passwordHash?: string }).passwordHash;
    }
    return batch;
  }

  async getRows(
    batchId: string,
    query: { status?: PopulationImportRowStatus; page: number; limit: number },
  ): Promise<Paginated<VillagePopulationImportRow>> {
    const qb = this.rowRepository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.matchedVillage', 'village')
      .where('r.batch.id = :batchId', { batchId })
      .orderBy('r.rowNumber', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  /**
   * A human (admin/analyst) decision on one HIERARCHY_MISMATCH /
   * REGION_NOT_FOUND / NEEDS_REVIEW row — never automatic, never fuzzy.
   * Only allowed while the batch is still READY (before confirm): a
   * resolution that flips a row to VALID must still go through the same
   * confirm/import pass as every other row, not bolt on a separate write
   * path. ACCEPTED on a row this reviewer isn't entitled to re-target
   * (HIERARCHY_MISMATCH keeps the code-matched village as-is — if that
   * match itself is wrong, the correct action is REJECTED, not picking a
   * different village through this endpoint) vs. REGION_NOT_FOUND/
   * NEEDS_REVIEW (no usable existing match, so a villageId is required).
   */
  async resolveRow(
    batchId: string,
    rowId: string,
    params: ResolveRowParams,
    actorUserId: string,
  ): Promise<VillagePopulationImportRow> {
    const batch = await this.batchRepository.findOne({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== PopulationImportBatchStatus.READY) {
      throw new ConflictException(
        `Batch berstatus "${batch.status}" — penyelesaian manual hanya dapat dilakukan saat batch berstatus "ready" (sebelum konfirmasi)`,
      );
    }

    const row = await this.rowRepository.findOne({
      where: { id: rowId, batch: { id: batchId } },
    });
    if (!row) throw new NotFoundException('Import row not found');
    if (!RESOLVABLE_ROW_STATUSES.has(row.status)) {
      throw new BadRequestException(
        `Baris berstatus "${row.status}" tidak memerlukan/tidak mendukung penyelesaian manual`,
      );
    }

    if (params.action === PopulationImportRowResolutionAction.ACCEPTED) {
      if (row.status === PopulationImportRowStatus.HIERARCHY_MISMATCH) {
        if (params.villageId) {
          throw new BadRequestException(
            'villageId tidak digunakan untuk baris hierarchy_mismatch — kecocokan kode yang sudah ada diterima apa adanya, atau tolak baris ini jika kecocokan itu sendiri salah',
          );
        }
      } else {
        if (!params.villageId) {
          throw new BadRequestException(
            `villageId wajib diisi untuk menerima baris berstatus "${row.status}"`,
          );
        }
        const village = await this.villageRepository.findOne({
          where: { id: params.villageId },
        });
        if (!village) {
          throw new NotFoundException('Wilayah tujuan tidak ditemukan');
        }
        row.matchedVillage = village;
        row.normalizedCode = village.code;
      }
      row.status = PopulationImportRowStatus.VALID;
      row.messages = [
        ...row.messages,
        `Diterima secara manual oleh admin/analyst${params.note ? ` — ${params.note}` : ''}`,
      ];
    } else {
      row.messages = [
        ...row.messages,
        `Ditandai bukan kecocokan oleh admin/analyst${params.note ? ` — ${params.note}` : ''}`,
      ];
    }

    row.resolutionAction = params.action;
    row.resolutionNote = params.note ?? null;
    row.resolvedBy = { id: actorUserId } as User;
    row.resolvedAt = new Date();

    const saved = await this.rowRepository.save(row);

    if (params.action === PopulationImportRowResolutionAction.ACCEPTED) {
      // Keep the batch's cached summary counts in sync with this row's new
      // status — confirmBatch()/the import worker always query rows
      // directly by status (never trust these cached counts for
      // correctness), but the preview UI displays them, and they'd
      // otherwise silently drift from what the rows actually contain.
      await this.batchRepository
        .createQueryBuilder()
        .update(VillagePopulationImportBatch)
        .set({
          validRowCount: () => '"valid_row_count" + 1',
          invalidCount: () => '"invalid_count" - 1',
        })
        .where('id = :batchId', { batchId })
        .execute();
    }

    return saved;
  }

  /**
   * Atomic DB-level compare-and-swap: READY -> QUEUED. A single
   * `UPDATE ... WHERE status = 'ready'` is itself the concurrency guard —
   * Postgres serializes two concurrent UPDATEs against the same row, so
   * exactly one call ever sees `affected === 1`; the other sees `0` and is
   * rejected with 409 before it can enqueue a second import job. This is
   * the guard against a double-click or two concurrent confirm requests,
   * not "disable the button" (which only helps one client, not two tabs or
   * two users).
   */
  async confirmBatch(batchId: string): Promise<VillagePopulationImportBatch> {
    const jobId = `import-${batchId}`;
    const result = await this.batchRepository
      .createQueryBuilder()
      .update(VillagePopulationImportBatch)
      .set({
        status: PopulationImportBatchStatus.QUEUED,
        confirmedAt: new Date(),
        importJobId: jobId,
      })
      .where('id = :batchId', { batchId })
      .andWhere('status = :readyStatus', {
        readyStatus: PopulationImportBatchStatus.READY,
      })
      .execute();

    if (result.affected === 0) {
      const batch = await this.batchRepository.findOne({
        where: { id: batchId },
      });
      if (!batch) throw new NotFoundException('Import batch not found');
      throw new ConflictException(
        `Batch berstatus "${batch.status}" — hanya batch berstatus "ready" yang dapat dikonfirmasi (mencegah impor ganda)`,
      );
    }

    await this.importQueue.add('import', { batchId }, { ...JOB_OPTS, jobId });
    return this.getBatch(batchId);
  }

  /**
   * Re-enqueues a FAILED batch's remaining work. Which queue depends on
   * how far it got: `readyAt == null` means it never finished validation
   * (resume from `lastValidatedRowNumber`, possibly 0); otherwise
   * validation had completed and the failure was during/after import
   * (resume from `lastImportedRowNumber` — already-IMPORTED rows are
   * untouched, the worker only continues past the checkpoint). Uses the
   * same atomic `WHERE status = 'failed'` CAS as confirmBatch so two
   * concurrent retry calls can't both enqueue a job.
   */
  async retryBatch(batchId: string): Promise<VillagePopulationImportBatch> {
    const batch = await this.batchRepository.findOne({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== PopulationImportBatchStatus.FAILED) {
      throw new ConflictException(
        `Batch berstatus "${batch.status}" — hanya batch berstatus "failed" yang dapat di-retry`,
      );
    }

    const retrySuffix = Date.now();
    const resumingImport = batch.readyAt != null;
    const jobId = resumingImport
      ? `import-${batchId}-retry-${retrySuffix}`
      : `validate-${batchId}-retry-${retrySuffix}`;

    const result = await this.batchRepository
      .createQueryBuilder()
      .update(VillagePopulationImportBatch)
      .set(
        resumingImport
          ? {
              status: PopulationImportBatchStatus.QUEUED,
              errorMessage: null,
              importJobId: jobId,
            }
          : {
              status: PopulationImportBatchStatus.UPLOADED,
              errorMessage: null,
              validationJobId: jobId,
            },
      )
      .where('id = :batchId', { batchId })
      .andWhere('status = :failedStatus', {
        failedStatus: PopulationImportBatchStatus.FAILED,
      })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException(
        'Batch sudah berubah status sebelum retry diproses — coba muat ulang status batch',
      );
    }

    if (resumingImport) {
      await this.importQueue.add('import', { batchId }, { ...JOB_OPTS, jobId });
    } else {
      await this.validationQueue.add(
        'validate',
        { batchId },
        { ...JOB_OPTS, jobId },
      );
    }
    return this.getBatch(batchId);
  }

  /**
   * Yields the error report as CSV chunks, at most `ERROR_REPORT_PAGE_SIZE`
   * rows materialized at a time — never the whole (potentially tens of
   * thousands of rows) report in memory or in the browser at once. Keyset
   * (row_number > cursor) pagination, not OFFSET: correct regardless of
   * how many rows exist, and rows are immutable by the time a batch has
   * reached a terminal status (the only time this is called).
   */
  async *streamErrorReportRows(batchId: string): AsyncGenerator<string> {
    const header = [
      'row_number',
      'status',
      'messages',
      'kode_pum',
      'provinsi',
      'kabupaten_kota',
      'kecamatan',
      'desa_kelurahan',
    ];
    yield stringify([header], { delimiter: ';' });

    let cursor = 0;
    for (;;) {
      const rows = await this.rowRepository
        .createQueryBuilder('r')
        .where('r.batch.id = :batchId', { batchId })
        .andWhere('r.status IN (:...statuses)', {
          statuses: [...ROWS_NOT_WRITTEN],
        })
        .andWhere('r.rowNumber > :cursor', { cursor })
        .orderBy('r.rowNumber', 'ASC')
        .take(ERROR_REPORT_PAGE_SIZE)
        .getMany();
      if (rows.length === 0) return;

      const records = rows.map((r) => [
        String(r.rowNumber),
        r.status,
        r.messages.join(' | '),
        r.kodePum ?? '',
        r.rawFields?.['Provinsi'] ?? '',
        r.rawFields?.['Kabupaten/Kota'] ?? '',
        r.rawFields?.['Kecamatan'] ?? '',
        r.rawFields?.['Desa/Kelurahan'] ?? '',
      ]);
      // Formula-injection guard: a cell starting with =,+,-,@ is coerced to
      // a formula by Excel/Sheets on open. Prefix with a plain quote so
      // it's read as literal text.
      const sanitized = records.map((record) =>
        record.map((cell) => (/^[=+\-@]/.test(cell) ? `'${cell}` : cell)),
      );
      yield stringify(sanitized, { delimiter: ';' });

      cursor = rows[rows.length - 1].rowNumber;
      if (rows.length < ERROR_REPORT_PAGE_SIZE) return;
    }
  }
}
