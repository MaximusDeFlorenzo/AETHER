import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { District } from './district.entity';

/**
 * DEM slope sampled around one kabupaten/kota reference point
 * (docs/RAINFALL_INTELLIGENCE.md, Milestone 4): a grid of sites over the
 * same ±0.05° footprint as the rainfall cell, one slope per land site.
 * Kept as raw samples so the landslide baseline can class them with
 * configurable thresholds. Not an area statistic of the district (no
 * boundaries exist).
 */
@Entity('district_terrain_profiles')
export class DistrictTerrainProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => District, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'varchar', length: 40 })
  source: string;

  // e.g. 'Copernicus GLO-90'
  @Column({ type: 'varchar', length: 60 })
  dem: string;

  /** One slope (degrees) per land site; sea/coast sites are dropped. */
  @Column({ type: 'jsonb', name: 'slope_samples_deg' })
  slopeSamplesDeg: number[];

  @Column({ type: 'real', nullable: true, name: 'slope_median_deg' })
  slopeMedianDeg: number | null;

  @Column({ type: 'real', nullable: true, name: 'slope_max_deg' })
  slopeMaxDeg: number | null;

  @Column({ type: 'integer', nullable: true, name: 'elevation_mean_m' })
  elevationMeanM: number | null;

  @Column({ type: 'integer', nullable: true, name: 'elevation_min_m' })
  elevationMinM: number | null;

  @Column({ type: 'integer', nullable: true, name: 'elevation_max_m' })
  elevationMaxM: number | null;

  @Column({ type: 'integer', name: 'samples_planned' })
  samplesPlanned: number;

  @Column({ type: 'integer', name: 'samples_valid' })
  samplesValid: number;

  @Column({ type: 'real', name: 'grid_half_width_deg' })
  gridHalfWidthDeg: number;

  @Column({ type: 'real', name: 'stencil_offset_deg' })
  stencilOffsetDeg: number;

  @Column({ type: 'timestamptz', name: 'sampled_at' })
  sampledAt: Date;
}
