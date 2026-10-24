import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GroundReport } from './ground-report.entity';
import { User } from './user.entity';

/**
 * One evidence photo attached to a ground report. `storageKey` points at
 * the metadata-stripped copy (ground-reports/lib/image-evidence.ts); the
 * original upload is never stored. `exif` keeps only capture time and GPS
 * from the original, for reviewers — never returned to anyone else.
 */
@Entity('ground_report_evidence')
export class GroundReportEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => GroundReport, (report) => report.evidence, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'report_id',
    foreignKeyConstraintName: 'ground_report_evidence_report_id_fkey',
  })
  report: GroundReport;

  @Index('idx_ground_report_evidence_report')
  @Column({ type: 'uuid', name: 'report_id' })
  reportId: string;

  @Column({ type: 'text', name: 'storage_key' })
  storageKey: string;

  /** Sniffed from the file's bytes, not the client's Content-Type. */
  @Column({ type: 'varchar', length: 40, name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'integer', name: 'size_bytes' })
  sizeBytes: number;

  /** Of the uploaded original — what recycled-photo matching compares. */
  @Index('idx_ground_report_evidence_sha256')
  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'jsonb', nullable: true })
  exif: Record<string, unknown> | null;

  // CV engine output for this photo — a triage hint, never evidence that
  // the observation is true. Null when the engine was unavailable.
  @Column({ type: 'jsonb', name: 'cv_hint', nullable: true })
  cvHint: Record<string, unknown> | null;

  // Earliest earlier evidence with the same sha256 — from ANY report or
  // reporter, so a recycled photo is visible to the reviewer.
  @ManyToOne(() => GroundReportEvidence, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'duplicate_of_evidence_id',
    foreignKeyConstraintName:
      'ground_report_evidence_duplicate_of_evidence_id_fkey',
  })
  duplicateOfEvidence: GroundReportEvidence | null;

  @Column({ type: 'uuid', name: 'duplicate_of_evidence_id', nullable: true })
  duplicateOfEvidenceId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'uploaded_by_user_id',
    foreignKeyConstraintName: 'ground_report_evidence_uploaded_by_user_id_fkey',
  })
  uploadedBy: User;

  @Column({ type: 'uuid', name: 'uploaded_by_user_id' })
  uploadedById: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
