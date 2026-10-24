import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { District } from './district.entity';

/**
 * A static hazard-index raster (BNPB InaRISK) summarised around one
 * kabupaten/kota reference point (docs/RAINFALL_INTELLIGENCE.md, Milestone
 * 3). The layers are 100 m rasters and a district point is a single
 * GeoNames point, so one pixel would say more about the street the point
 * sits on than about the district: the point plus four neighbours
 * `sample_offset_deg` away are sampled and summarised. Not an area
 * average over the district (no boundaries exist).
 */
@Entity('district_hazard_indices')
@Unique('uq_district_hazard_indices_district_layer', ['district', 'layer'])
export class DistrictHazardIndex {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => District, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'district_id' })
  district: District;

  // e.g. 'INDEKS_BAHAYA_BANJIR'
  @Column({ type: 'varchar', length: 60 })
  layer: string;

  @Column({ type: 'varchar', length: 40 })
  source: string;

  /** Mean of the valid samples; null when every sample was NoData. */
  @Column({ type: 'real', nullable: true, name: 'value_mean' })
  valueMean: number | null;

  @Column({ type: 'real', nullable: true, name: 'value_max' })
  valueMax: number | null;

  /** The pixel at the district point itself. */
  @Column({ type: 'real', nullable: true, name: 'value_center' })
  valueCenter: number | null;

  @Column({ type: 'integer', name: 'samples_total' })
  samplesTotal: number;

  @Column({ type: 'integer', name: 'samples_valid' })
  samplesValid: number;

  @Column({ type: 'real', name: 'sample_offset_deg' })
  sampleOffsetDeg: number;

  @Column({ type: 'timestamptz', name: 'sampled_at' })
  sampledAt: Date;
}
