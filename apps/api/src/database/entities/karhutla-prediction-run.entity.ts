import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { KarhutlaClusterForecast } from './karhutla-cluster-forecast.entity';
import {
  KarhutlaRunStatus,
  KarhutlaRunTrigger,
} from '../../karhutla-prediction/karhutla.enums';

/**
 * One execution of the karhutla (forest/land fire) spread + smoke pipeline
 * over every recent FIRMS hotspot cluster — see
 * karhutla-prediction/karhutla-prediction.service.ts. At most one run can be
 * queued/running at a time (partial unique index in the migration), which
 * is what makes manual + scheduled triggers idempotent.
 */
@Entity('karhutla_prediction_runs')
export class KarhutlaPredictionRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({
    type: 'enum',
    enum: KarhutlaRunStatus,
    enumName: 'karhutla_run_status',
  })
  status: KarhutlaRunStatus;

  @Column({
    type: 'enum',
    enum: KarhutlaRunTrigger,
    enumName: 'karhutla_run_trigger',
  })
  trigger: KarhutlaRunTrigger;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by_user_id' })
  requestedBy: User | null;

  // The forecast reference time every horizon is measured from — set when
  // the job starts executing, not when it was queued.
  @Column({ type: 'timestamptz', name: 'issued_at', nullable: true })
  issuedAt: Date | null;

  @Column({ type: 'integer', array: true, name: 'horizons_hours' })
  horizonsHours: number[];

  @Column({ type: 'integer', name: 'max_clusters' })
  maxClusters: number;

  @Column({ type: 'integer', name: 'hotspot_window_hours' })
  hotspotWindowHours: number;

  @Column({
    type: 'varchar',
    length: 60,
    name: 'spread_model_version',
    nullable: true,
  })
  spreadModelVersion: string | null;

  @Column({
    type: 'varchar',
    length: 60,
    name: 'smoke_model_version',
    nullable: true,
  })
  smokeModelVersion: string | null;

  // Hotspot counts, exclusions and per-source provenance/freshness.
  @Column({ type: 'jsonb', name: 'input_summary', nullable: true })
  inputSummary: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  warnings: string[];

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @OneToMany(() => KarhutlaClusterForecast, (forecast) => forecast.run)
  forecasts: KarhutlaClusterForecast[];
}
