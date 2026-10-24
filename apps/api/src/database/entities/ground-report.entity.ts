import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  GroundObservationType,
  GroundReportSeverity,
  GroundReportStatus,
} from '../../ground-reports/ground-report.enums';
import { numericTransformer } from '../transformers/numeric.transformer';
import { District } from './district.entity';
import { User } from './user.entity';
import { GroundReportEvidence } from './ground-report-evidence.entity';
import { GroundReportStatusChange } from './ground-report-status-change.entity';

/**
 * One community observation (AETHER Ground Intelligence M1). Deliberately
 * NOT a `hazard_events` row: a report — even a VERIFIED one — never feeds
 * risk scoring, notifications or the dashboard on its own. Exact
 * coordinates and `reporter` are reviewer-only (see GroundReportsService
 * views).
 */
@Entity('ground_reports')
@Check(
  'chk_ground_reports_water_depth',
  `water_depth_cm IS NULL OR (observation_type = 'floodwater' AND water_depth_cm BETWEEN 0 AND 1000)`,
)
@Index('idx_ground_reports_reporter_submitted', ['reporterId', 'submittedAt'])
export class GroundReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: GroundObservationType,
    enumName: 'ground_observation_type',
    name: 'observation_type',
  })
  observationType: GroundObservationType;

  @Index('idx_ground_reports_status')
  @Column({
    type: 'enum',
    enum: GroundReportStatus,
    enumName: 'ground_report_status',
    default: GroundReportStatus.SUBMITTED,
  })
  status: GroundReportStatus;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    transformer: numericTransformer,
  })
  latitude: number;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    transformer: numericTransformer,
  })
  longitude: number;

  @Index('idx_ground_reports_geom', { spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    select: false,
  })
  geom: object;

  // Nearest district REFERENCE POINT — districts.geom holds points, not
  // boundaries, so this is a review hint, not proof of containment.
  @ManyToOne(() => District, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'nearest_district_id',
    foreignKeyConstraintName: 'ground_reports_nearest_district_id_fkey',
  })
  nearestDistrict: District | null;

  @Column({ type: 'uuid', name: 'nearest_district_id', nullable: true })
  nearestDistrictId: string | null;

  /** When the reporter says they saw it (client-supplied, validated). */
  @Column({ type: 'timestamptz', name: 'observed_at' })
  observedAt: Date;

  /** Server receive time — never client-supplied. */
  @CreateDateColumn({ type: 'timestamptz', name: 'submitted_at' })
  submittedAt: Date;

  @Column({ type: 'text' })
  description: string;

  // Floodwater only; reporter-estimated, not a gauge reading.
  @Column({ type: 'integer', name: 'water_depth_cm', nullable: true })
  waterDepthCm: number | null;

  @Column({
    type: 'enum',
    enum: GroundReportSeverity,
    enumName: 'ground_report_severity',
    name: 'reporter_severity',
    nullable: true,
  })
  reporterSeverity: GroundReportSeverity | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reporter_user_id',
    foreignKeyConstraintName: 'ground_reports_reporter_user_id_fkey',
  })
  reporter: User;

  @Column({ type: 'uuid', name: 'reporter_user_id' })
  reporterId: string;

  // Same reporter re-sending the same observation (lib/report-rules.ts).
  @ManyToOne(() => GroundReport, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'duplicate_of_id',
    foreignKeyConstraintName: 'ground_reports_duplicate_of_id_fkey',
  })
  duplicateOf: GroundReport | null;

  @Column({ type: 'uuid', name: 'duplicate_of_id', nullable: true })
  duplicateOfId: string | null;

  // Separate from review status on purpose: VERIFIED never implies
  // training-eligible. No endpoint writes this in M1; eligibility decisions
  // come with dataset versioning.
  @Column({ type: 'boolean', name: 'training_eligible', default: false })
  trainingEligible: boolean;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'last_reviewed_by_user_id',
    foreignKeyConstraintName: 'ground_reports_last_reviewed_by_user_id_fkey',
  })
  lastReviewedBy: User | null;

  @Column({ type: 'uuid', name: 'last_reviewed_by_user_id', nullable: true })
  lastReviewedById: string | null;

  @Column({ type: 'timestamptz', name: 'last_reviewed_at', nullable: true })
  lastReviewedAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => GroundReportEvidence, (evidence) => evidence.report)
  evidence: GroundReportEvidence[];

  @OneToMany(() => GroundReportStatusChange, (change) => change.report)
  statusHistory: GroundReportStatusChange[];
}
