import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { DataSource, EntityManager, MoreThan, Repository } from 'typeorm';
import {
  Village,
  VillagePopulation,
  VillagePopulationImportBatch,
  VillagePopulationImportRow,
} from '../../database/entities';
import {
  PopulationImportBatchStatus,
  PopulationImportRowStatus,
} from '../../common/enums/domain.enum';
import { VILLAGE_POPULATION_CONFIRM_QUEUE } from '../../queue/queue.module';

export interface ImportJobPayload {
  batchId: string;
}

/**
 * Writes one batch's VALID rows into `village_populations`, chunk by
 * chunk, each chunk in its own reasonably-sized transaction (never one
 * transaction for the whole file). Re-checks conflicts against the
 * database TWICE per chunk — once before writing (to skip rows already
 * satisfied) and once after (to detect a concurrently-running batch that
 * raced this one for the same village+period and won) — so two batches
 * confirmed at the same time for overlapping data can never both believe
 * they "won"; exactly one becomes IMPORTED per key, the other correctly
 * lands on UNCHANGED or CONFLICT depending on whether the winner's data
 * matches.
 *
 * Resumable via `batch.lastImportedRowNumber`: each chunk's row-status
 * updates, population inserts, and checkpoint advance commit together, so
 * a crash mid-chunk leaves nothing partially applied to resume from
 * incorrectly.
 */
@Processor(VILLAGE_POPULATION_CONFIRM_QUEUE)
export class ImportProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    @InjectRepository(VillagePopulationImportBatch)
    private readonly batchRepository: Repository<VillagePopulationImportBatch>,
    @InjectRepository(VillagePopulationImportRow)
    private readonly rowRepository: Repository<VillagePopulationImportRow>,
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

  // See ValidationProcessor.onModuleInit — `@Processor()`'s options can't
  // read from ConfigService (decorator evaluates before DI exists), so
  // concurrency is set on the live Worker once DI is up instead.
  onModuleInit(): void {
    this.worker.concurrency =
      this.config.get<number>(
        'VILLAGE_POPULATION_IMPORT_CONFIRM_CONCURRENCY',
      ) ?? 1;
  }

  async process(job: Job<ImportJobPayload>): Promise<void> {
    const { batchId } = job.data;
    const batch = await this.batchRepository.findOne({
      where: { id: batchId },
    });
    if (!batch) {
      throw new UnrecoverableError(`Batch ${batchId} not found`);
    }
    if (
      batch.status !== PopulationImportBatchStatus.QUEUED &&
      batch.status !== PopulationImportBatchStatus.IMPORTING
    ) {
      this.logger.log(
        `Batch ${batchId} is already "${batch.status}" — skipping`,
      );
      return;
    }

    if (batch.status === PopulationImportBatchStatus.QUEUED) {
      batch.status = PopulationImportBatchStatus.IMPORTING;
      batch.importingStartedAt = new Date();
      batch.importJobId = String(job.id);
      await this.batchRepository.save(batch);
    }

    for (;;) {
      const rows = await this.rowRepository.find({
        where: {
          batch: { id: batchId },
          rowNumber: MoreThan(batch.lastImportedRowNumber ?? 0),
        },
        relations: { matchedVillage: true },
        order: { rowNumber: 'ASC' },
        take: this.chunkSize,
      });
      if (rows.length === 0) break;

      const checkpoint = rows[rows.length - 1].rowNumber;
      await this.dataSource.transaction(async (manager) => {
        await this.importChunk(manager, batch, rows);
        await manager.update(VillagePopulationImportBatch, batchId, {
          lastImportedRowNumber: checkpoint,
        });
      });
      // The transaction above commits the new checkpoint to the DATABASE
      // row — it does NOT mutate this in-memory `batch` object. Without
      // this line, the next iteration's `MoreThan(batch.lastImportedRowNumber)`
      // keeps using the stale value from before the loop started, so it
      // re-fetches the exact same chunk forever and never terminates.
      // Found live in the 100k-row e2e test: the loop span 46%+ CPU
      // indefinitely, re-processing rows 1-2000 on every pass, while the
      // DB checkpoint itself sat frozen right after the first chunk.
      batch.lastImportedRowNumber = checkpoint;
      await job.updateProgress({
        phase: 'importing',
        processedRows: checkpoint,
      });
    }

    await this.finalize(batch);
  }

  private async importChunk(
    manager: EntityManager,
    batch: VillagePopulationImportBatch,
    rows: VillagePopulationImportRow[],
  ): Promise<void> {
    const candidates = rows.filter(
      (r) => r.status === PopulationImportRowStatus.VALID && r.matchedVillage,
    );
    if (candidates.length === 0) {
      return;
    }

    const villageIds = [
      ...new Set(candidates.map((r) => r.matchedVillage!.id)),
    ];

    // Pre-write check: has this exact key already been satisfied since
    // this row was classified VALID (e.g. an earlier chunk of a resumed
    // run, or a different batch, wrote it first)?
    const beforeByKey = await this.fetchExistingByKey(manager, villageIds);

    const toInsert: Partial<VillagePopulation>[] = [];
    for (const row of candidates) {
      const key = `${row.matchedVillage!.id}|${row.dedupeKey}`;
      const existing = beforeByKey.get(key);
      if (existing) {
        row.status = this.rowMatchesExisting(row, existing)
          ? PopulationImportRowStatus.UNCHANGED
          : PopulationImportRowStatus.CONFLICT;
        continue;
      }
      toInsert.push({
        village: { id: row.matchedVillage!.id } as Village,
        male: row.male,
        female: row.female,
        totalPopulation: row.totalPopulation,
        households: row.households,
        densityRaw: row.densityRaw,
        densityConverted: row.densityConverted,
        numberFormat: batch.numberFormat,
        reportedDate: row.parsedDate,
        periodStatus: batch.periodStatus,
        periodYear: batch.periodYear,
        dedupeKey: row.dedupeKey,
        sourceName: batch.sourceName,
        sourceReference: batch.sourceReference,
        importBatch: { id: batch.id } as VillagePopulationImportBatch,
      });
    }

    if (toInsert.length > 0) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(VillagePopulation)
        .values(toInsert)
        .orIgnore()
        .execute();
    }

    // Post-write check: re-read what actually exists now. If another
    // transaction (a different batch, or another chunk of a raced-but-
    // resumed run of THIS batch) won the insert for a key we also tried,
    // ours was silently ignored — the row must reflect that honestly
    // (CONFLICT if the winner's data differs from ours, UNCHANGED if it's
    // the same), never claim IMPORTED for a row this transaction didn't
    // actually persist.
    const afterByKey = await this.fetchExistingByKey(manager, villageIds);
    for (const row of candidates) {
      if (row.status !== PopulationImportRowStatus.VALID) continue; // already classified above
      const key = `${row.matchedVillage!.id}|${row.dedupeKey}`;
      const finalRow = afterByKey.get(key);
      if (!finalRow) {
        // Should be unreachable (we just inserted it and nothing in this
        // transaction deletes rows) — fail safe rather than claim success.
        row.status = PopulationImportRowStatus.SKIPPED;
        row.messages = [
          ...row.messages,
          'Status akhir tidak dapat dikonfirmasi — dilewati',
        ];
        continue;
      }
      row.status = this.rowMatchesExisting(row, finalRow)
        ? PopulationImportRowStatus.IMPORTED
        : PopulationImportRowStatus.CONFLICT;
      if (row.status === PopulationImportRowStatus.CONFLICT) {
        row.messages = [
          ...row.messages,
          'Batch lain menulis data berbeda untuk wilayah/sumber/periode yang sama tepat sebelum baris ini — ditandai konflik',
        ];
      }
    }

    // Only `candidates` ever have their status touched in this function —
    // `rows` also includes non-candidate rows (already invalid/duplicate/
    // region_not_found/etc. from validation) that are untouched here;
    // saving the whole chunk unconditionally would issue a no-op UPDATE
    // for every one of them, the same wasted-per-row-write pattern fixed
    // in ValidationProcessor.reclassifyAgainstStoredData.
    await manager.save(VillagePopulationImportRow, candidates);
  }

  private rowMatchesExisting(
    row: VillagePopulationImportRow,
    existing: {
      male: number | null;
      female: number | null;
      totalPopulation: number | null;
      households: number | null;
      densityRaw: string | null;
    },
  ): boolean {
    return (
      existing.male === row.male &&
      existing.female === row.female &&
      existing.totalPopulation === row.totalPopulation &&
      existing.households === row.households &&
      existing.densityRaw === row.densityRaw
    );
  }

  private async fetchExistingByKey(
    manager: { query: DataSource['query'] },
    villageIds: string[],
  ): Promise<
    Map<
      string,
      {
        male: number | null;
        female: number | null;
        totalPopulation: number | null;
        households: number | null;
        densityRaw: string | null;
      }
    >
  > {
    if (villageIds.length === 0) return new Map();
    const rows: Array<{
      village_id: string;
      dedupe_key: string;
      male: number | null;
      female: number | null;
      total_population: number | null;
      households: number | null;
      density_raw: string | null;
    }> = await manager.query(
      `SELECT village_id, dedupe_key, male, female, total_population, households, density_raw
       FROM village_populations WHERE village_id = ANY($1::uuid[])`,
      [villageIds],
    );
    return new Map(
      rows.map((r) => [
        `${r.village_id}|${r.dedupe_key}`,
        {
          male: r.male,
          female: r.female,
          totalPopulation: r.total_population,
          households: r.households,
          densityRaw: r.density_raw,
        },
      ]),
    );
  }

  /**
   * Mirror of ValidationProcessor.onFailed — fires once BullMQ has
   * exhausted every retry attempt or the job stalled past
   * `maxStalledCount` (dead worker, nothing resumed it). The only path
   * that moves a batch stuck in IMPORTING to FAILED without a human retry.
   * Deliberately does NOT reset `importedCount`/`lastImportedRowNumber` —
   * whatever chunks already committed stay committed and are reported
   * honestly as partial progress; `retryBatch()` resumes past the
   * checkpoint rather than reimporting them.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ImportJobPayload> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    // See ValidationProcessor.onFailed — an `UnrecoverableError` (BullMQ's
    // own stalled-job failure) is always terminal regardless of attempts
    // remaining; verified live that missing this case leaves a batch
    // stuck in IMPORTING forever after a worker dies and its restart
    // arrives too late to prevent BullMQ's own stalled-job limit.
    const isUnrecoverable = error.name === 'UnrecoverableError';
    if (!isUnrecoverable && attemptsMade < maxAttempts) return;

    const batch = await this.batchRepository.findOne({
      where: { id: job.data.batchId },
    });
    if (!batch || batch.status !== PopulationImportBatchStatus.IMPORTING)
      return;
    batch.status = PopulationImportBatchStatus.FAILED;
    batch.errorMessage = `Impor gagal setelah ${attemptsMade} percobaan: ${error.message}`;
    await this.batchRepository.save(batch);
  }

  private async finalize(batch: VillagePopulationImportBatch): Promise<void> {
    const counts: Array<{ status: PopulationImportRowStatus; count: string }> =
      await this.dataSource.query(
        `SELECT status, count(*)::text AS count FROM village_population_import_rows
         WHERE batch_id = $1 GROUP BY status`,
        [batch.id],
      );
    const byStatus = new Map(counts.map((c) => [c.status, Number(c.count)]));
    const importedCount = byStatus.get(PopulationImportRowStatus.IMPORTED) ?? 0;
    const totalRows = batch.totalRows ?? 0;
    const skippedCount = totalRows - importedCount;

    batch.importedCount = importedCount;
    batch.skippedCount = skippedCount;
    batch.status =
      skippedCount === 0
        ? PopulationImportBatchStatus.COMPLETED
        : PopulationImportBatchStatus.COMPLETED_WITH_ERRORS;
    batch.completedAt = new Date();
    await this.batchRepository.save(batch);
  }
}
