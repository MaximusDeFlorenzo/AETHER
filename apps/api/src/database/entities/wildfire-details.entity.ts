import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { HazardEvent } from './hazard-event.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// Phase 2 — schema included now per docs/DATABASE_SCHEMA.md §14 so Phase 2 is
// additive; no ingestion adapter or business logic populates this table yet.
@Entity('wildfire_details')
export class WildfireDetails {
  @PrimaryColumn({ type: 'uuid', name: 'hazard_event_id' })
  hazardEventId: string;

  @OneToOne(() => HazardEvent, (event) => event.wildfireDetails, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent;

  // FIRMS fire radiative power confidence, 0-1.
  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    nullable: true,
    name: 'frp_confidence',
    transformer: numericTransformer,
  })
  frpConfidence: number | null;

  @Column({ type: 'integer', nullable: true, name: 'hotspot_count' })
  hotspotCount: number | null;

  @Column({
    type: 'numeric',
    precision: 7,
    scale: 2,
    nullable: true,
    name: 'brightness_kelvin',
    transformer: numericTransformer,
  })
  brightnessKelvin: number | null;
}
