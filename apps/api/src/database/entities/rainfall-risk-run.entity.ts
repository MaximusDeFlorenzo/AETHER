import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type RainfallRiskHazard = 'flood' | 'landslide';
export type RainfallRiskRunStatus =
  'completed' | 'insufficient_data' | 'failed';

/**
 * One rainfall-driven hazard-risk run (docs/RAINFALL_INTELLIGENCE.md,
 * Milestones 3–4) for every kabupaten/kota point: the engine model version,
 * the parameters (thresholds) it used, where each input came from and how
 * fresh it was, and the per-district results exactly as the engine
 * returned them.
 */
@Entity('rainfall_risk_runs')
@Index('idx_rainfall_risk_runs_hazard_issued_at', ['hazard', 'issuedAt'])
export class RainfallRiskRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  hazard: RainfallRiskHazard;

  @Column({ type: 'varchar', length: 30 })
  status: RainfallRiskRunStatus;

  // 'scheduled' | 'manual'
  @Column({ type: 'varchar', length: 20 })
  trigger: string;

  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt: Date;

  /** Newest rainfall hour any district's assessment rests on. */
  @Column({ type: 'timestamptz', name: 'data_valid_time', nullable: true })
  dataValidTime: Date | null;

  @Column({
    type: 'varchar',
    length: 60,
    name: 'model_version',
    nullable: true,
  })
  modelVersion: string | null;

  @Column({ type: 'jsonb' })
  parameters: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'input_summary', nullable: true })
  inputSummary: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  results: unknown[] | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  warnings: string[];

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;
}
