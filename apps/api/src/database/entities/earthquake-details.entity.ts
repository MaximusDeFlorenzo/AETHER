import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { HazardEvent } from './hazard-event.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

@Entity('earthquake_details')
export class EarthquakeDetails {
  @PrimaryColumn({ type: 'uuid', name: 'hazard_event_id' })
  hazardEventId: string;

  @OneToOne(() => HazardEvent, (event) => event.earthquakeDetails, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent;

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 1,
    transformer: numericTransformer,
  })
  magnitude: number;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 1,
    name: 'depth_km',
    transformer: numericTransformer,
  })
  depthKm: number;

  @Column({ type: 'boolean', default: false, name: 'potential_tsunami' })
  potentialTsunami: boolean;
}
