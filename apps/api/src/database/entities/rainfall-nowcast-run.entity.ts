import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type RainfallNowcastStatus =
  'completed' | 'insufficient_data' | 'failed';

/**
 * One Stage-1 rain nowcast run (docs/RAINFALL_INTELLIGENCE.md, Milestone 2)
 * with everything needed to answer "which model, on which data, how
 * confident": engine model versions, the rain frames' valid times, the
 * parameters, an input summary, and the per-district results exactly as the
 * engine returned them.
 */
@Entity('rainfall_nowcast_runs')
export class RainfallNowcastRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_rainfall_nowcast_runs_status')
  @Column({ type: 'varchar', length: 30 })
  status: RainfallNowcastStatus;

  // 'scheduled' | 'manual'
  @Column({ type: 'varchar', length: 20 })
  trigger: string;

  @Index('idx_rainfall_nowcast_runs_issued_at')
  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt: Date;

  /** Valid time of the newest rain frame the forecast starts from. */
  @Column({ type: 'timestamptz', name: 'data_valid_time', nullable: true })
  dataValidTime: Date | null;

  @Column({ type: 'timestamptz', name: 'previous_valid_time', nullable: true })
  previousValidTime: Date | null;

  @Column({ type: 'varchar', length: 40, name: 'rain_source' })
  rainSource: string;

  @Column({ type: 'jsonb', name: 'model_versions', nullable: true })
  modelVersions: Record<string, string> | null;

  @Column({ type: 'integer', array: true, name: 'horizons_hours' })
  horizonsHours: number[];

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
