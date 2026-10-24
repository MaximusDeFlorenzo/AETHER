import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PublicAlertHazard } from '../../public-alerts/public-alert.enums';
import { EmergencyPhase } from '../../regional-status/emergency-phase.enum';
import { District } from './district.entity';
import { User } from './user.entity';

// An official emergency status for a whole kabupaten/kota, as declared by a
// Pemda decree — e.g. "Tanggap Darurat Karhutla s.d. 15 Oktober". Recorded
// by an operator; the citizen portal shows it and never rates the area
// below its floor level while it is in force. Extending = editing ends_on.
@Entity('regional_emergency_statuses')
export class RegionalEmergencyStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => District, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'enum', enum: EmergencyPhase, enumName: 'emergency_phase' })
  phase: EmergencyPhase;

  @Column({
    type: 'enum',
    enum: PublicAlertHazard,
    enumName: 'public_alert_hazard',
  })
  hazard: PublicAlertHazard;

  // Calendar dates (local to the declaring Pemda), inclusive on both ends.
  @Column({ type: 'date', name: 'starts_on' })
  startsOn: string;

  @Column({ type: 'date', name: 'ends_on' })
  endsOn: string;

  @Column({
    type: 'varchar',
    length: 160,
    nullable: true,
    name: 'decree_number',
  })
  decreeNumber: string | null;

  // Who declared it, shown verbatim, e.g. "Pemkab Barito Utara".
  @Column({ type: 'varchar', length: 160, name: 'source_label' })
  sourceLabel: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'source_url' })
  sourceUrl: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: User | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  // Revoked before ends_on.
  @Column({ type: 'timestamptz', nullable: true, name: 'ended_at' })
  endedAt: Date | null;
}
