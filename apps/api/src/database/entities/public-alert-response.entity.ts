import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PublicAlertResponseStatus } from '../../public-alerts/public-alert.enums';
import { numericTransformer } from '../transformers/numeric.transformer';
import { PublicAlert } from './public-alert.entity';

// A citizen's "Saya sudah aman" / "Butuh bantuan" answer to an alarm. One
// row per device per alert (the anonymous `deviceId` is generated and kept
// in the browser), so changing the answer overwrites rather than stacking.
@Entity('public_alert_responses')
@Unique('uq_public_alert_response_device', ['alert', 'deviceId'])
export class PublicAlertResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_public_alert_responses_alert')
  @ManyToOne(() => PublicAlert, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alert_id' })
  alert: PublicAlert;

  @Column({ type: 'varchar', length: 64, name: 'device_id' })
  deviceId: string;

  @Column({
    type: 'enum',
    enum: PublicAlertResponseStatus,
    enumName: 'public_alert_response_status',
  })
  status: PublicAlertResponseStatus;

  // Only sent when the citizen asks for help and allows location access.
  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  latitude: number | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  longitude: number | null;

  // Optional details a citizen asking for help can add, for the rescue team.
  @Column({ type: 'smallint', nullable: true, name: 'people_count' })
  peopleCount: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
    name: 'contact_phone',
  })
  contactPhone: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
