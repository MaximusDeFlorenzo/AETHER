import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { HazardEvent } from './hazard-event.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

@Entity('landslide_details')
export class LandslideDetails {
  @PrimaryColumn({ type: 'uuid', name: 'hazard_event_id' })
  hazardEventId: string;

  @OneToOne(() => HazardEvent, (event) => event.landslideDetails, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    name: 'slope_degrees',
    transformer: numericTransformer,
  })
  slopeDegrees: number | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    nullable: true,
    name: 'soil_saturation',
    transformer: numericTransformer,
  })
  soilSaturation: number | null;

  @Column({
    type: 'numeric',
    precision: 7,
    scale: 2,
    nullable: true,
    name: 'triggering_rainfall_mm',
    transformer: numericTransformer,
  })
  triggeringRainfallMm: number | null;
}
