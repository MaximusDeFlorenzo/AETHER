import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Village } from './village.entity';
import { VillagePopulationImportBatch } from './village-population-import-batch.entity';
import {
  PopulationNumberFormat,
  PopulationPeriodStatus,
} from '../../common/enums/domain.enum';
import { numericTransformer } from '../transformers/numeric.transformer';

// Kelurahan/desa population, imported from CSV (never fabricated, never
// split from a parent kabupaten/kota — see docs/ARCHITECTURE.md §5 and
// docs/DATABASE_SCHEMA.md §6c). Distinct from `population_statistics`
// (kabupaten/kota-only, BPS/Kemendagri registry) because this data has a
// richer, source-reported shape (male/female/KK/raw density) and a
// genuinely unknown period in many real rows — forcing it into the
// district-level table's `year NOT NULL` shape would either fabricate a
// year or block import outright.
//
// `dedupeKey` is the explicit, NOT NULL identity `docs/DATABASE_SCHEMA.md
// §6c` requires instead of relying on a unique constraint over a nullable
// `periodYear` (which Postgres would treat as always-distinct, silently
// allowing duplicate "unknown period" rows for the same village). Computed
// as `year:<periodYear>` when the period is confirmed, or
// `unknown:<reportedDate ?? 'no-date'>:<sourceName>` when it isn't — see
// `village-population-import.service.ts::computeDedupeKey` (the single
// place this logic lives; VillagePopulationImportRow.dedupeKey uses the
// same function so preview-time conflict detection matches confirm-time
// detection exactly).
@Entity('village_populations')
@Unique(['village', 'dedupeKey'])
export class VillagePopulation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Village, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'village_id' })
  village: Village;

  // Distinct from empty/unreported — see PopulationImportRowStatus and the
  // import service: an empty CSV cell parses to `null` here, never `0`.
  @Column({ type: 'int', nullable: true })
  male: number | null;

  @Column({ type: 'int', nullable: true })
  female: number | null;

  @Column({ type: 'int', nullable: true, name: 'total_population' })
  totalPopulation: number | null;

  @Column({ type: 'int', nullable: true })
  households: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'density_raw' })
  densityRaw: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
    name: 'density_converted',
    transformer: numericTransformer,
  })
  densityConverted: number | null;

  @Column({
    type: 'enum',
    enum: PopulationNumberFormat,
    nullable: true,
    name: 'number_format',
  })
  numberFormat: PopulationNumberFormat | null;

  // The CSV's own "Tanggal" column — the date the SOURCE reported this row
  // as of, not a confirmed statistical period. Never assumed to be one
  // (docs/DATABASE_SCHEMA.md §6c).
  @Column({ type: 'date', nullable: true, name: 'reported_date' })
  reportedDate: string | null;

  @Column({
    type: 'enum',
    enum: PopulationPeriodStatus,
    name: 'period_status',
  })
  periodStatus: PopulationPeriodStatus;

  @Column({ type: 'smallint', nullable: true, name: 'period_year' })
  periodYear: number | null;

  @Column({ type: 'varchar', length: 300, name: 'dedupe_key' })
  dedupeKey: string;

  @Column({ type: 'varchar', length: 200, name: 'source_name' })
  sourceName: string;

  @Column({ type: 'text', nullable: true, name: 'source_reference' })
  sourceReference: string | null;

  // Nullable (not cascade-critical): the batch record may in principle be
  // pruned later without invalidating the population figure it produced —
  // `sourceName`/`sourceReference`/`reportedDate` above are the durable
  // provenance; this FK is the traceability convenience on top.
  @Index()
  @ManyToOne(() => VillagePopulationImportBatch, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'import_batch_id' })
  importBatch: VillagePopulationImportBatch | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
