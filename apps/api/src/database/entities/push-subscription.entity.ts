import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { District } from './district.entity';
import { Subdistrict } from './subdistrict.entity';
import { Village } from './village.entity';

// A browser's Web Push subscription, tied to an area rather than to a user
// account — citizens enable emergency alarms without signing up. Stores no
// name, phone number or precise location, only the area they picked.
@Entity('push_subscriptions')
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  endpoint: string;

  @Column({ type: 'varchar', length: 255 })
  p256dh: string;

  @Column({ type: 'varchar', length: 255 })
  auth: string;

  @Index('idx_push_subscriptions_district')
  @ManyToOne(() => District, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @ManyToOne(() => Subdistrict, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subdistrict_id' })
  subdistrict: Subdistrict | null;

  @ManyToOne(() => Village, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'village_id' })
  village: Village | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'user_agent' })
  userAgent: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_success_at' })
  lastSuccessAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
