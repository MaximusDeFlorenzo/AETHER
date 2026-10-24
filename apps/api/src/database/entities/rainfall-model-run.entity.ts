import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type RainfallModelRunStatus =
  'completed' | 'insufficient_data' | 'failed';

/**
 * One training + evaluation run of a gated Rainfall Intelligence model
 * (docs/RAINFALL_INTELLIGENCE.md, Milestone 5): the data window and its
 * chronological split, the fitted coefficients, test-period scores against
 * every Stage-1 baseline, and which horizons passed the promotion gate.
 * The newest completed run of a task decides what live nowcasts may use.
 */
@Entity('rainfall_model_runs')
@Index('idx_rainfall_model_runs_task_issued_at', ['task', 'issuedAt'])
export class RainfallModelRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // e.g. 'rain_nowcast_spatial'
  @Column({ type: 'varchar', length: 40 })
  task: string;

  @Column({ type: 'varchar', length: 30 })
  status: RainfallModelRunStatus;

  // 'scheduled' | 'manual'
  @Column({ type: 'varchar', length: 20 })
  trigger: string;

  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt: Date;

  @Column({
    type: 'varchar',
    length: 60,
    name: 'model_version',
    nullable: true,
  })
  modelVersion: string | null;

  /** First and last start hour used, split boundaries, row counts. */
  @Column({ type: 'jsonb', name: 'data_summary', nullable: true })
  dataSummary: Record<string, unknown> | null;

  /** Feature names, gate parameters, threshold. */
  @Column({ type: 'jsonb' })
  parameters: Record<string, unknown>;

  /** Per horizon: coefficients, test scores, baseline comparisons, gate. */
  @Column({ type: 'jsonb', nullable: true })
  results: unknown[] | null;

  @Column({ type: 'jsonb', name: 'promoted_horizons', default: () => "'[]'" })
  promotedHorizons: number[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  warnings: string[];

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;
}
