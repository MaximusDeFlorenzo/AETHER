import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../transformers/numeric.transformer';
import { District } from './district.entity';
import { KarhutlaPredictionRun } from './karhutla-prediction-run.entity';
import { KarhutlaForecastStatus } from '../../karhutla-prediction/karhutla.enums';

/**
 * Spread + smoke forecast for one spatial cluster of FIRMS hotspots within
 * a run. Observed inputs (hotspot ids, footprint, timestamps) and model
 * outputs (`spread`, `smoke`) live in separate columns so the API and UI can
 * never present one as the other.
 */
@Entity('karhutla_cluster_forecasts')
export class KarhutlaClusterForecast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => KarhutlaPredictionRun, (run) => run.forecasts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'run_id' })
  run: KarhutlaPredictionRun;

  // 1 = largest cluster by total FRP in this run.
  @Column({ type: 'integer' })
  rank: number;

  @Column({
    type: 'enum',
    enum: KarhutlaForecastStatus,
    enumName: 'karhutla_forecast_status',
  })
  status: KarhutlaForecastStatus;

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
  centroid: object;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'location_label',
    nullable: true,
  })
  locationLabel: string | null;

  @ManyToOne(() => District, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'nearest_district_id' })
  nearestDistrict: District | null;

  @Column({ type: 'integer', name: 'hotspot_count' })
  hotspotCount: number;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    name: 'total_frp_mw',
    nullable: true,
    transformer: numericTransformer,
  })
  totalFrpMw: number | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    name: 'max_confidence',
    nullable: true,
    transformer: numericTransformer,
  })
  maxConfidence: number | null;

  @Column({ type: 'timestamptz', name: 'first_observed_at' })
  firstObservedAt: Date;

  @Column({ type: 'timestamptz', name: 'latest_observed_at' })
  latestObservedAt: Date;

  @Column({ type: 'uuid', array: true, name: 'hotspot_event_ids' })
  hotspotEventIds: string[];

  @Column({ type: 'text', array: true })
  sensors: string[];

  // Convex hull of hotspot pixels (observation, not a perimeter).
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    name: 'observed_footprint',
    nullable: true,
  })
  observedFootprint: object | null;

  @Column({ type: 'jsonb', nullable: true })
  spread: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  smoke: Record<string, unknown> | null;

  // Surface weather series used at the source, with provenance.
  @Column({ type: 'jsonb', nullable: true })
  weather: Record<string, unknown> | null;

  @Column({ type: 'jsonb', name: 'data_quality' })
  dataQuality: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  exposure: Record<string, unknown>[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  recommendations: Record<string, unknown>[];

  // Qualitative input-quality label ('low' | 'very_low'), never a probability.
  @Column({ type: 'varchar', length: 20, nullable: true })
  confidence: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
