import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VillagePopulationImportBatch } from './village-population-import-batch.entity';
import { Village } from './village.entity';
import { User } from './user.entity';
import {
  PopulationImportRowResolutionAction,
  PopulationImportRowStatus,
} from '../../common/enums/domain.enum';
import { numericTransformer } from '../transformers/numeric.transformer';

// One row per CSV data row (excluding the header row, if any) — the full
// parse/validate/match audit trail, kept independent of whether the row
// ends up imported. Never mutated after preview except `status` (and its
// counterpart on the batch) at confirm time — the raw/parsed fields are a
// point-in-time record of what THIS parse produced, per docs/DATABASE_SCHEMA.md
// §6d's "simpan ... waktu impor, nomor baris, dan hasil setiap baris"
// requirement.
@Entity('village_population_import_rows')
export class VillagePopulationImportRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => VillagePopulationImportBatch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch: VillagePopulationImportBatch;

  // 1-indexed position within the file's DATA rows (i.e. row 1 is always
  // the first row of actual data, whether or not a header preceded it) —
  // this is the number shown to the user, matching "nomor baris" in error
  // messages.
  @Column({ type: 'int', name: 'row_number' })
  rowNumber: number;

  @Column({ type: 'text', name: 'raw_line' })
  rawLine: string;

  // The 12 fields exactly as the CSV parser produced them (quotes stripped
  // by the parser, not by string replacement), keyed by the canonical
  // column names from the spec — kept even when column order in the
  // source file differed (header mode) or a value fails validation, for
  // traceability.
  @Column({ type: 'jsonb', name: 'raw_fields' })
  rawFields: Record<string, string>;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'kode_pum' })
  kodePum: string | null;

  // "1109072008" -> "11.09.07.2008", only set once the 10-digit structure
  // is confirmed and it resolves to a real province.district.subdistrict
  // chain — see village-population-import.service.ts::normalizeKodePum.
  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    name: 'normalized_code',
  })
  normalizedCode: string | null;

  @Index()
  @ManyToOne(() => Village, { nullable: true })
  @JoinColumn({ name: 'matched_village_id' })
  matchedVillage: Village | null;

  // Populated only for NEEDS_REVIEW (0, 1, or many villages found via the
  // provinsi/kabupaten/kecamatan/desa hierarchy fallback, when Kode PUM was
  // absent — see row-processor.ts) — shown to a reviewing admin/analyst as
  // a convenience so they don't have to re-run the same hierarchy search
  // by hand; `resolveRow` never requires the chosen villageId to be one of
  // these, since a human reviewer may know better than the heuristic.
  @Column({ type: 'jsonb', nullable: true, name: 'candidate_village_ids' })
  candidateVillageIds: string[] | null;

  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
    name: 'parsed_date_raw',
  })
  parsedDateRaw: string | null;

  @Column({ type: 'date', nullable: true, name: 'parsed_date' })
  parsedDate: string | null;

  @Column({ type: 'int', nullable: true, name: 'male' })
  male: number | null;

  @Column({ type: 'int', nullable: true, name: 'female' })
  female: number | null;

  @Column({ type: 'int', nullable: true, name: 'total_population' })
  totalPopulation: number | null;

  @Column({ type: 'int', nullable: true, name: 'households' })
  households: number | null;

  // Preserved byte-for-byte from the source (e.g. "26.000") — never
  // normalized in this column, per docs/DATABASE_SCHEMA.md §6c.
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
    enum: PopulationImportRowStatus,
  })
  status: PopulationImportRowStatus;

  // Human-readable findings (e.g. "Laki-Laki + Perempuan (520) tidak sama
  // dengan Jumlah Penduduk (525)", "Kode PUM 1199999999 tidak ditemukan di
  // hierarki wilayah") — never silently corrected, always surfaced here.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  messages: string[];

  // Identity used to detect "same fact reported twice" — see
  // VillagePopulation.dedupeKey for the exact computation (kept identical
  // here so a preview's conflict/duplicate detection matches confirm-time
  // detection exactly).
  @Column({ type: 'varchar', length: 300, name: 'dedupe_key' })
  dedupeKey: string;

  // Manual resolution of a HIERARCHY_MISMATCH / REGION_NOT_FOUND /
  // NEEDS_REVIEW row by an admin/analyst, via
  // `VillagePopulationImportService.resolveRow` — see
  // `PopulationImportRowResolutionAction`'s comment. `resolvedAt` is the
  // non-null signal that a human reviewed this row at all (ACCEPTED or
  // REJECTED both set it); a null `resolutionAction` means never reviewed.
  @Column({
    type: 'enum',
    enum: PopulationImportRowResolutionAction,
    nullable: true,
    name: 'resolution_action',
  })
  resolutionAction: PopulationImportRowResolutionAction | null;

  @Column({ type: 'text', nullable: true, name: 'resolution_note' })
  resolutionNote: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolved_by_user_id' })
  resolvedBy: User | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
