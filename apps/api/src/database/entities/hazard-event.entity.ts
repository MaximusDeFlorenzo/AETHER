import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { HazardType } from '../../common/enums/domain.enum';
import { numericTransformer } from '../transformers/numeric.transformer';
import { EarthquakeDetails } from './earthquake-details.entity';
import { LandslideDetails } from './landslide-details.entity';
import { FloodDetails } from './flood-details.entity';
import { WildfireDetails } from './wildfire-details.entity';
import { HazardAffectedRegion } from './hazard-affected-region.entity';
import { RiskAssessment } from './risk-assessment.entity';

// Replaces ORION's single-purpose `earthquakes` table. One row per detected
// hazard occurrence, hazard-agnostic core columns; hazard-specific data
// lives in the *_details tables (1:1) — docs/DATABASE_SCHEMA.md §10.
@Entity('hazard_events')
@Unique('uq_hazard_event_dedupe', ['externalId', 'source'])
export class HazardEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: HazardType, name: 'hazard_type' })
  hazardType: HazardType;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'external_id' })
  externalId: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    transformer: numericTransformer,
  })
  latitude: number;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    transformer: numericTransformer,
  })
  longitude: number;

  @Index({ spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326 })
  geom: object;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'location_label',
  })
  locationLabel: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  region: string | null;

  @Index()
  @Column({ type: 'timestamptz', name: 'event_time' })
  eventTime: Date;

  // 'bmkg_autogempa' | 'weather_api' | 'nasa_firms' | 'manual' | ...
  @Column({ type: 'varchar', length: 60 })
  source: string;

  @Column({ type: 'jsonb', name: 'raw_payload' })
  rawPayload: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToOne(() => EarthquakeDetails, (details) => details.hazardEvent)
  earthquakeDetails: EarthquakeDetails;

  @OneToOne(() => LandslideDetails, (details) => details.hazardEvent)
  landslideDetails: LandslideDetails;

  @OneToOne(() => FloodDetails, (details) => details.hazardEvent)
  floodDetails: FloodDetails;

  @OneToOne(() => WildfireDetails, (details) => details.hazardEvent)
  wildfireDetails: WildfireDetails;

  @OneToMany(() => HazardAffectedRegion, (region) => region.hazardEvent)
  affectedRegions: HazardAffectedRegion[];

  @OneToMany(() => RiskAssessment, (assessment) => assessment.hazardEvent)
  riskAssessments: RiskAssessment[];
}
