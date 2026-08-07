import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { HazardEvent } from './hazard-event.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// Phase 2 (docs/DATABASE_SCHEMA.md §13) — populated by WeatherAdapter
// (ingestion/adapters/weather.adapter.ts) via HazardEventsService.ingestEvent().
@Entity('flood_details')
export class FloodDetails {
  @PrimaryColumn({ type: 'uuid', name: 'hazard_event_id' })
  hazardEventId: string;

  @OneToOne(() => HazardEvent, (event) => event.floodDetails, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent;

  @Column({
    type: 'numeric',
    precision: 7,
    scale: 2,
    nullable: true,
    name: 'rainfall_mm',
    transformer: numericTransformer,
  })
  rainfallMm: number | null;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    name: 'water_level_m',
    transformer: numericTransformer,
  })
  waterLevelM: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true, name: 'river_basin' })
  riverBasin: string | null;
}
