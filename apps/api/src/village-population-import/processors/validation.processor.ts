import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import {
  Village,
  VillagePopulationImportBatch,
  VillagePopulationImportRow,
} from '../../database/entities';
import {
  PopulationImportBatchStatus,
  PopulationImportRowStatus,
} from '../../common/enums/domain.enum';
import { StorageService } from '../../storage/storage.service';
import { VILLAGE_POPULATION_VALIDATION_QUEUE } from '../../queue/queue.module';
import { CsvStructureError, parseCsvStream } from '../lib/csv-parser';
import { processRow, type ProcessedRow } from '../lib/row-processor';
import { buildVillageLookup } from '../lib/village-lookup';

export interface ValidationJobPayload {
  batchId: string;
}

interface ExistingPopulationRow {
  villageId: string;
  dedupeKey: string;
  male: number | null;
  female: number | null;
  totalPopulation: number | null;
  households: number | null;
  densityRaw: string | null;
}

/**
 * Validates one batch end to end: streams the stored CSV, parses/matches/
 * classifies each row, persists results in chunk-sized transactions with a
 * resumable checkpoint, then reclassifies VALID rows against already-stored
 * population data (unchanged/conflict). Never holds the full parsed file in
 * memory — only one chunk at a time plus the villages lookup table (a few
 * MB, loaded once per run).
 *
 * Resumability: `process()` is safe to re-run on the exact same batch,
 * whether that's BullMQ redelivering a stalled job after this worker died,
 * or an operator manually re-queuing after a FAILED-for-transient-reasons
 * run. It picks up from `batch.lastValidatedRowNumber`, reconstructing the
 * in-file-duplicate-detection state from rows already durably persisted
 * rather than re-deriving it from scratch (which would misdetect
 * duplicates across a resume boundary).
 */
@Processor(VILLAGE_POPULATION_VALIDATION_QUEUE)
export class ValidationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ValidationProcessor.name);

  constructor(
    @InjectRepository(VillagePopulationImportBatch)
    private readonly batchRepository: Repository<VillagePopulationImportBatch>,
    @InjectRepository(VillagePopulationImportRow)
    private readonly rowRepository: Repository<VillagePopulationImportRow>,
    @InjectRepository(Village)
    private readonly villageRepository: Repository<Village>,
    private readonly storageService: StorageService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    super();
  }

  private get chunkSize(): number {
    return (
      this.config.get<number>('VILLAGE_POPULATION_IMPORT_CHUNK_SIZE') ?? 2000
    );
  }

  // `@Processor()`'s options are evaluated when this class is decorated
  // (at module-load time, before Nest's DI/ConfigModule exist), so
  // concurrency can't be passed there from config. `WorkerHost.worker` is
  // the live underlying BullMQ Worker — settable once DI is up.
  onModuleInit(): void {
    this.worker.concurrency =
      this.config.get<number>(
        'VILLAGE_POPULATION_IMPORT_VALIDATION_CONCURRENCY',
      ) ?? 1;
  }

  async process(job: Job<ValidationJobPayload>): Promise<void> {
    const { batchId } = job.data;
    const batch = await this.batchRepository.findOne({
      where: { id: batchId },
    });
    if (!batch) {
      // Nothing to retry against — permanent failure, tells BullMQ to stop.
      throw new UnrecoverableError(`Batch ${batchId} not found`);
    }
    if (
      batch.status !== PopulationImportBatchStatus.UPLOADED &&
      batch.status !== PopulationImportBatchStatus.VALIDATING
    ) {
      // Already validated (or moved past it) by a previous run of this same
      // job — a safe no-op, not an error, so a redelivered/duplicated job
      // never reprocesses a finished batch.
      this.logger.log(
        `Batch ${batchId} is already "${batch.status}" — skipping`,
      );
      return;
    }

    if (batch.status === PopulationImportBatchStatus.UPLOADED) {
      batch.status = PopulationImportBatchStatus.VALIDATING;
      batch.validatingStartedAt = new Date();
      batch.validationJobId = String(job.id);
      await this.batchRepository.save(batch);
    }

    try {
      const totalRows = await this.streamAndPersistRows(batch, job);
      await this.reclassifyAgainstStoredData(batch.id);
      await this.finalize(batch, totalRows);
    } catch (error) {
      if (error instanceof CsvStructureError) {
        // Permanent: the file itself is structurally invalid — retrying
        // won't help, and BullMQ must not keep re-attempting it.
        batch.status = PopulationImportBatchStatus.FAILED;
        batch.errorMessage = error.message;
        await this.batchRepository.save(batch);
        return;
      }
      // Transient (DB hiccup, storage read failure, etc.) — rethrow so
      // BullMQ applies its retry/backoff policy (configured on the queue
      // add() call in the service). `lastValidatedRowNumber` already
      // reflects the last durably-committed chunk, so the retry resumes
      // rather than restarting.
      this.logger.warn(
        `Validation job for batch ${batchId} failed transiently: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /** Streams the file, classifies each row (structural + region-match +
   * duplicate-in-file), and persists in chunk-sized, checkpointed
   * transactions. Returns the total row count once the stream ends. */
  private async streamAndPersistRows(
    batch: VillagePopulationImportBatch,
    job: Job<ValidationJobPayload>,
  ): Promise<number> {
    const lookup = await buildVillageLookup(this.villageRepository);
    const resumeFrom = batch.lastValidatedRowNumber ?? 0;
    const seenInFileKeys = await this.reconstructSeenKeys(batch.id, resumeFrom);

    const fileStream = await this.storageService.downloadObjectStream(
      batch.storageKey,
    );
    const settings = {
      numberFormat: batch.numberFormat,
      periodStatus: batch.periodStatus,
      periodYear: batch.periodYear,
      sourceName: batch.sourceName,
    };

    let chunk: ProcessedRow[] = [];
    let rowCount = resumeFrom;

    for await (const csvRow of parseCsvStream(fileStream, batch.hasHeaderRow)) {
      if (csvRow.rowNumber <= resumeFrom) continue; // already committed in a prior run

      const processed = processRow(csvRow, lookup, settings);
      if (
        processed.status === PopulationImportRowStatus.VALID &&
        processed.matchedVillageId
      ) {
        const key = `${processed.matchedVillageId}|${processed.dedupeKey}`;
        if (seenInFileKeys.has(key)) {
          processed.status = PopulationImportRowStatus.DUPLICATE_IN_FILE;
          processed.messages.push(
            'Baris lain di file yang sama sudah melaporkan wilayah dan periode/sumber yang identik — baris ini dilewati',
          );
        } else {
          seenInFileKeys.add(key);
        }
      }

      chunk.push(processed);
      rowCount = csvRow.rowNumber;

      if (chunk.length >= this.chunkSize) {
        await this.persistChunk(batch.id, chunk, rowCount);
        await job.updateProgress({
          phase: 'validating',
          processedRows: rowCount,
        });
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      await this.persistChunk(batch.id, chunk, rowCount);
      await job.updateProgress({
        phase: 'validating',
        processedRows: rowCount,
      });
    }
    return rowCount;
  }

  /** Rebuilds the in-file duplicate-detection Set from rows already
   * durably persisted (status VALID/UNCHANGED/CONFLICT all mean "this row
   * matched a village and claimed a dedupe key") — needed so resuming
   * after a crash doesn't lose track of duplicates that were already
   * detected before the checkpoint. */
  private async reconstructSeenKeys(
    batchId: string,
    resumeFrom: number,
  ): Promise<Set<string>> {
    const seen = new Set<string>();
    if (resumeFrom === 0) return seen;
    const rows = await this.rowRepository.find({
      where: {
        batch: { id: batchId },
        status: In([
          PopulationImportRowStatus.VALID,
          PopulationImportRowStatus.UNCHANGED,
          PopulationImportRowStatus.CONFLICT,
        ]),
      },
      relations: { matchedVillage: true },
    });
    for (const row of rows) {
      if (row.matchedVillage)
        seen.add(`${row.matchedVillage.id}|${row.dedupeKey}`);
    }
    return seen;
  }

  /** Insert + checkpoint advance in ONE transaction — either both commit or
   * neither does, so a crash mid-chunk never leaves the checkpoint ahead of
   * what's actually persisted (which would silently skip rows on resume).
   * `.orIgnore()` (ON CONFLICT DO NOTHING on the `(batch_id, row_number)`
   * unique constraint) is a defensive backstop against a theoretical
   * doubly-delivered job overlapping with itself, not the primary
   * resume mechanism — the checkpoint being transactional with the insert
   * is what makes the common crash-and-resume path correct. */
  private async persistChunk(
    batchId: string,
    chunk: ProcessedRow[],
    checkpointRowNumber: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const values = chunk.map((row) => ({
        batch: { id: batchId } as VillagePopulationImportBatch,
        rowNumber: row.rowNumber,
        rawLine: row.rawLine,
        rawFields: row.rawFields ?? {},
        kodePum: row.kodePum,
        normalizedCode: row.normalizedCode,
        matchedVillage: row.matchedVillageId
          ? ({ id: row.matchedVillageId } as Village)
          : null,
        parsedDateRaw: row.parsedDateRaw,
        parsedDate: row.parsedDate,
        male: row.male,
        female: row.female,
        totalPopulation: row.totalPopulation,
        households: row.households,
        densityRaw: row.densityRaw,
        densityConverted: row.densityConverted,
        status: row.status,
        messages: row.messages,
        dedupeKey: row.dedupeKey,
        candidateVillageIds:
          row.candidateVillageIds.length > 0 ? row.candidateVillageIds : null,
      }));
      await manager
        .createQueryBuilder()
        .insert()
        .into(VillagePopulationImportRow)
        .values(values)
        .orIgnore()
        .execute();
      await manager.update(VillagePopulationImportBatch, batchId, {
        lastValidatedRowNumber: checkpointRowNumber,
        processedRows: checkpointRowNumber,
      });
    });
  }

  /** Reclassifies rows still at VALID against already-stored
   * `village_populations` (unchanged/conflict). Cursor-paginated on
   * `rowNumber` (not a shrinking-WHERE-set assumption — a chunk where
   * ZERO of the `chunkSize` fetched rows happen to have pre-existing data
   * would otherwise never advance, since none of them leave the `status =
   * VALID` filter; found live in the 100k-row e2e test, where the
   * overwhelming majority of chunks have no pre-existing collisions at
   * all and the loop never terminated). The cursor advances by this
   * chunk's last `rowNumber` every iteration regardless of how many rows
   * in it actually changed status, so progress is guaranteed. Only rows
   * that actually change status are written — not the whole chunk
   * unconditionally — since re-saving thousands of untouched rows per
   * chunk is exactly the per-row-cost this importer is meant to avoid at
   * 100k-row scale. No separate DB checkpoint: safe to resume from
   * `rowNumber > 0` after a crash (re-examining already-fine rows is
   * wasted work, never incorrect, since each row's fresh classification
   * only depends on current stored data, not on prior runs). */
  private async reclassifyAgainstStoredData(batchId: string): Promise<void> {
    let cursor = 0;
    for (;;) {
      const rows = await this.rowRepository.find({
        where: {
          batch: { id: batchId },
          status: PopulationImportRowStatus.VALID,
          rowNumber: MoreThan(cursor),
        },
        relations: { matchedVillage: true },
        order: { rowNumber: 'ASC' },
        take: this.chunkSize,
      });
      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].rowNumber;

      const villageIds = [...new Set(rows.map((r) => r.matchedVillage!.id))];
      const existing = await this.fetchExistingPopulations(villageIds);
      const existingByKey = new Map(
        existing.map((e) => [`${e.villageId}|${e.dedupeKey}`, e]),
      );

      const changedRows: VillagePopulationImportRow[] = [];
      for (const row of rows) {
        const key = `${row.matchedVillage!.id}|${row.dedupeKey}`;
        const existingRow = existingByKey.get(key);
        if (!existingRow) continue; // stays VALID — not written
        const identical =
          existingRow.male === row.male &&
          existingRow.female === row.female &&
          existingRow.totalPopulation === row.totalPopulation &&
          existingRow.households === row.households &&
          existingRow.densityRaw === row.densityRaw;
        row.status = identical
          ? PopulationImportRowStatus.UNCHANGED
          : PopulationImportRowStatus.CONFLICT;
        row.messages = [
          ...row.messages,
          identical
            ? 'Data identik dengan yang sudah tersimpan — tidak diimpor ulang'
            : 'Data sudah tersimpan untuk wilayah/sumber/periode ini dengan nilai berbeda — ditandai konflik, tidak ditimpa otomatis',
        ];
        changedRows.push(row);
      }
      if (changedRows.length > 0) {
        await this.rowRepository.save(changedRows);
      }
    }
  }

  private async fetchExistingPopulations(
    villageIds: string[],
  ): Promise<ExistingPopulationRow[]> {
    if (villageIds.length === 0) return [];
    const rows: Array<{
      village_id: string;
      dedupe_key: string;
      male: number | null;
      female: number | null;
      total_population: number | null;
      households: number | null;
      density_raw: string | null;
    }> = await this.dataSource.query(
      `SELECT village_id, dedupe_key, male, female, total_population, households, density_raw
       FROM village_populations WHERE village_id = ANY($1::uuid[])`,
      [villageIds],
    );
    return rows.map((r) => ({
      villageId: r.village_id,
      dedupeKey: r.dedupe_key,
      male: r.male,
      female: r.female,
      totalPopulation: r.total_population,
      households: r.households,
      densityRaw: r.density_raw,
    }));
  }

  /**
   * Fires once BullMQ has exhausted every retry attempt (or the job
   * stalled past `maxStalledCount`, e.g. a worker process died mid-job and
   * nothing picked it back up) — the only place a batch stuck in
   * VALIDATING is ever moved out of that state without a human retry. Does
   * nothing while attempts remain (`attemptsMade < attempts`): a
   * transient failure BullMQ is about to retry must not flip the batch to
   * FAILED, since the next attempt may well succeed and resume from
   * `lastValidatedRowNumber`.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ValidationJobPayload> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    // `UnrecoverableError` (e.g. BullMQ's own "job stalled more than
    // allowable limit" — a dead/hung worker never renewed the job's lock)
    // fails a job permanently regardless of attempts remaining; found live
    // in the 100k-row e2e test that checking only `attemptsMade >=
    // maxAttempts` misses this case entirely, leaving the batch stuck in
    // VALIDATING forever with no automatic recovery — exactly what this
    // handler exists to prevent.
    const isUnrecoverable = error.name === 'UnrecoverableError';
    if (!isUnrecoverable && attemptsMade < maxAttempts) return;

    const batch = await this.batchRepository.findOne({
      where: { id: job.data.batchId },
    });
    if (!batch || batch.status !== PopulationImportBatchStatus.VALIDATING)
      return;
    batch.status = PopulationImportBatchStatus.FAILED;
    batch.errorMessage = `Validasi gagal setelah ${attemptsMade} percobaan: ${error.message}`;
    await this.batchRepository.save(batch);
  }

  private async finalize(
    batch: VillagePopulationImportBatch,
    totalRows: number,
  ): Promise<void> {
    const counts: Array<{ status: PopulationImportRowStatus; count: string }> =
      await this.dataSource.query(
        `SELECT status, count(*)::text AS count FROM village_population_import_rows
         WHERE batch_id = $1 GROUP BY status`,
        [batch.id],
      );
    const byStatus = new Map(counts.map((c) => [c.status, Number(c.count)]));
    const sum = (...statuses: PopulationImportRowStatus[]) =>
      statuses.reduce((total, s) => total + (byStatus.get(s) ?? 0), 0);

    batch.totalRows = totalRows;
    batch.validRowCount = sum(PopulationImportRowStatus.VALID);
    batch.duplicateInFileCount = sum(
      PopulationImportRowStatus.DUPLICATE_IN_FILE,
    );
    batch.unchangedCount = sum(PopulationImportRowStatus.UNCHANGED);
    batch.conflictCount = sum(PopulationImportRowStatus.CONFLICT);
    batch.invalidCount = sum(
      PopulationImportRowStatus.INVALID,
      PopulationImportRowStatus.REGION_NOT_FOUND,
      PopulationImportRowStatus.HIERARCHY_MISMATCH,
      PopulationImportRowStatus.NEEDS_REVIEW,
    );
    batch.status = PopulationImportBatchStatus.READY;
    batch.readyAt = new Date();
    await this.batchRepository.save(batch);
  }
}
