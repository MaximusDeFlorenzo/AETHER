import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import {
  PopulationImportBatchStatus,
  PopulationNumberFormat,
  PopulationPeriodStatus,
} from '../../common/enums/domain.enum';
import { numericTransformer } from '../transformers/numeric.transformer';

// One row per CSV upload attempt for kecamatan/kelurahan population data
// (docs/DATABASE_SCHEMA.md §6c). The raw file itself lives in object storage
// (`storageKey`, private bucket — see StorageService) so a batch can be
// re-diffed or re-audited later; this row is the reopenable status/summary
// record `village-population-import.service.ts` writes to and the frontend
// polls via GET, and the identity that binds every
// `VillagePopulationImportRow` and (once confirmed) `VillagePopulation` row
// back to who uploaded what, when, with which settings.
@Entity('village_population_import_batches')
export class VillagePopulationImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName: string;

  // SHA-256 of the exact uploaded bytes — lets a re-upload of the identical
  // file be recognized as such (not proof alone that nothing changed in the
  // DB since, but the file-identity half of "impor ulang tidak menciptakan
  // duplikasi").
  @Column({ type: 'varchar', length: 64, name: 'file_checksum_sha256' })
  @Index()
  fileChecksumSha256: string;

  @Column({
    type: 'bigint',
    name: 'file_size_bytes',
    transformer: numericTransformer,
  })
  fileSizeBytes: number;

  @Column({ type: 'varchar', length: 500, name: 'storage_key' })
  storageKey: string;

  @Index()
  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy: User;

  @Column({ type: 'boolean', name: 'has_header_row' })
  hasHeaderRow: boolean;

  @Column({
    type: 'enum',
    enum: PopulationNumberFormat,
    name: 'number_format',
  })
  numberFormat: PopulationNumberFormat;

  @Column({ type: 'varchar', length: 200, name: 'source_name' })
  sourceName: string;

  @Column({ type: 'text', nullable: true, name: 'source_reference' })
  sourceReference: string | null;

  @Column({
    type: 'enum',
    enum: PopulationPeriodStatus,
    name: 'period_status',
  })
  periodStatus: PopulationPeriodStatus;

  @Column({ type: 'smallint', nullable: true, name: 'period_year' })
  periodYear: number | null;

  @Column({
    type: 'enum',
    enum: PopulationImportBatchStatus,
    default: PopulationImportBatchStatus.UPLOADED,
  })
  status: PopulationImportBatchStatus;

  // BullMQ job ids (not auto-incrementing DB ids) — lets a status/log lookup
  // find the exact job, and the deterministic id scheme (`validate-<batchId>`
  // / `import-<batchId>`) gives BullMQ its own natural add-twice dedup as a
  // second layer behind the DB-CAS guard in confirmBatch().
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'validation_job_id',
  })
  validationJobId: string | null;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'import_job_id',
  })
  importJobId: string | null;

  // Resume checkpoints — the row_number through which VALIDATING/IMPORTING
  // has durably committed. A crashed worker's replacement resumes from here
  // instead of restarting (and re-counting) from row 1. NULL means nothing
  // committed yet for that phase.
  @Column({ type: 'int', nullable: true, name: 'last_validated_row_number' })
  lastValidatedRowNumber: number | null;

  @Column({ type: 'int', nullable: true, name: 'last_imported_row_number' })
  lastImportedRowNumber: number | null;

  // How many data rows the streaming parser has actually read so far —
  // shown to the user as "N baris diproses" during VALIDATING/IMPORTING.
  // Never paired with a fabricated percentage: `totalRows` is only known
  // once the full file has been read once (see the service's docstring).
  @Column({ type: 'int', nullable: true, name: 'processed_rows' })
  processedRows: number | null;

  @Column({ type: 'int', nullable: true, name: 'total_rows' })
  totalRows: number | null;

  @Column({ type: 'int', nullable: true, name: 'valid_row_count' })
  validRowCount: number | null;

  @Column({ type: 'int', nullable: true, name: 'duplicate_in_file_count' })
  duplicateInFileCount: number | null;

  @Column({ type: 'int', nullable: true, name: 'unchanged_count' })
  unchangedCount: number | null;

  @Column({ type: 'int', nullable: true, name: 'conflict_count' })
  conflictCount: number | null;

  @Column({ type: 'int', nullable: true, name: 'invalid_count' })
  invalidCount: number | null;

  @Column({ type: 'int', nullable: true, name: 'imported_count' })
  importedCount: number | null;

  @Column({ type: 'int', nullable: true, name: 'skipped_count' })
  skippedCount: number | null;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'validating_started_at',
  })
  validatingStartedAt: Date | null;

  // Set when status first reaches READY (validation done) — kept the same
  // column name/meaning as before (`previewedAt`) since it's the same
  // moment, just renamed to match the new status vocabulary.
  @Column({ type: 'timestamptz', nullable: true, name: 'ready_at' })
  readyAt: Date | null;

  // Set when confirmBatch()'s DB-CAS (READY -> QUEUED) succeeds — the
  // moment a human confirmed, distinct from when the worker actually
  // started writing (`importingStartedAt`) or finished (`completedAt`).
  @Column({ type: 'timestamptz', nullable: true, name: 'confirmed_at' })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'importing_started_at' })
  importingStartedAt: Date | null;

  // Set only once every chunk's writes are durably committed — never when
  // the import job is merely dequeued or started.
  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completedAt: Date | null;
}
