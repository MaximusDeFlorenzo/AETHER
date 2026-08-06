import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { HazardEvent } from './hazard-event.entity';
import { District } from './district.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// Replaces `earthquake_affected_districts` — same spatial-resolution audit
// trail, now hazard-agnostic (docs/DATABASE_SCHEMA.md §15).
@Entity('hazard_affected_regions')
@Unique(['hazardEvent', 'district'])
export class HazardAffectedRegion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => HazardEvent, (event) => event.affectedRegions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent;

  @Index()
  @ManyToOne(() => District)
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'distance_km',
    transformer: numericTransformer,
  })
  distanceKm: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
