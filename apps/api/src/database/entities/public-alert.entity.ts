import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  PublicAlertHazard,
  PublicAlertLevel,
  PublicAlertStatus,
} from '../../public-alerts/public-alert.enums';
import { numericTransformer } from '../transformers/numeric.transformer';
import { District } from './district.entity';
import { Subdistrict } from './subdistrict.entity';
import { Village } from './village.entity';
import { HazardEvent } from './hazard-event.entity';
import { User } from './user.entity';

// A citizen-facing emergency alarm ("layar merah"): one life-saving action
// for one area, issued by a human operator — never raised automatically by
// the risk engine. The one automatic path relays BMKG's own earthquake /
// tsunami-potential information (BmkgAutoAlertService, createdBy = null).
// Targets a district and optionally narrows to a
// subdistrict/village; see PublicAlertsService.findActiveForArea for how
// that narrowing matches subscribers who only picked a coarser area.
@Entity('public_alerts')
export class PublicAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: PublicAlertHazard,
    enumName: 'public_alert_hazard',
  })
  hazard: PublicAlertHazard;

  @Index('idx_public_alerts_status')
  @Column({
    type: 'enum',
    enum: PublicAlertStatus,
    enumName: 'public_alert_status',
    default: PublicAlertStatus.ACTIVE,
  })
  status: PublicAlertStatus;

  @Column({
    type: 'enum',
    enum: PublicAlertLevel,
    enumName: 'public_alert_level',
    default: PublicAlertLevel.AWAS,
  })
  level: PublicAlertLevel;

  // Short level label shown above the action, e.g. "Awas banjir".
  @Column({ type: 'varchar', length: 120 })
  title: string;

  // The single decision, e.g. "Pergi ke posko sekarang".
  @Column({ type: 'varchar', length: 160 })
  action: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    name: 'destination_name',
  })
  destinationName: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    name: 'destination_latitude',
    transformer: numericTransformer,
  })
  destinationLatitude: number | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    name: 'destination_longitude',
    transformer: numericTransformer,
  })
  destinationLongitude: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true, name: 'avoid_text' })
  avoidText: string | null;

  // Who the warning comes from, shown verbatim, e.g. "BPBD Kab. Sukabumi".
  @Column({ type: 'varchar', length: 160, name: 'source_label' })
  sourceLabel: string;

  @Index('idx_public_alerts_district')
  @ManyToOne(() => District, { nullable: false })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @ManyToOne(() => Subdistrict, { nullable: true })
  @JoinColumn({ name: 'subdistrict_id' })
  subdistrict: Subdistrict | null;

  @ManyToOne(() => Village, { nullable: true })
  @JoinColumn({ name: 'village_id' })
  village: Village | null;

  @ManyToOne(() => HazardEvent, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: User | null;

  @Column({ type: 'integer', default: 0, name: 'push_sent_count' })
  pushSentCount: number;

  @Column({ type: 'integer', default: 0, name: 'push_failed_count' })
  pushFailedCount: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // Hard stop so a forgotten alarm never keeps sounding indefinitely.
  @Index('idx_public_alerts_expires_at')
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'ended_at' })
  endedAt: Date | null;
}
