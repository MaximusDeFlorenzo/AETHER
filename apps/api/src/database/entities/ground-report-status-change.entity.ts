import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GroundReportStatus } from '../../ground-reports/ground-report.enums';
import { GroundReport } from './ground-report.entity';
import { User } from './user.entity';

/**
 * Append-only review history of a ground report: one row per status change,
 * including the initial submission (`fromStatus` null). A database trigger
 * rejects UPDATE and DELETE on this table (migration AddGroundReports).
 */
@Entity('ground_report_status_changes')
@Index('idx_ground_report_status_changes_report', ['reportId', 'createdAt'])
export class GroundReportStatusChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => GroundReport, (report) => report.statusHistory, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'report_id',
    foreignKeyConstraintName: 'ground_report_status_changes_report_id_fkey',
  })
  report: GroundReport;

  @Column({ type: 'uuid', name: 'report_id' })
  reportId: string;

  @Column({
    type: 'enum',
    enum: GroundReportStatus,
    enumName: 'ground_report_status',
    name: 'from_status',
    nullable: true,
  })
  fromStatus: GroundReportStatus | null;

  @Column({
    type: 'enum',
    enum: GroundReportStatus,
    enumName: 'ground_report_status',
    name: 'to_status',
  })
  toStatus: GroundReportStatus;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'ground_report_status_changes_actor_user_id_fkey',
  })
  actor: User;

  @Column({ type: 'uuid', name: 'actor_user_id' })
  actorUserId: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
