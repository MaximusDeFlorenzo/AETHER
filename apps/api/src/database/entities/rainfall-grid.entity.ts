import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * One hourly rain FIELD over the Indonesia domain (rainfall-intelligence/,
 * docs/RAINFALL_INTELLIGENCE.md) — what rain-motion tracking and nowcast
 * backtesting need, where `weather_hourly_samples` only holds one value per
 * district point.
 *
 * `data` is gzip-compressed little-endian float32, row-major, first row =
 * northernmost; NaN = missing. Geometry is given by cell CENTRES
 * (`west_lon`, `north_lat`) and `resolution_deg`. `valid_time` is the END of
 * the hour (same convention as `weather_hourly_samples`).
 */
@Entity('rainfall_grids')
@Unique('uq_rainfall_grids_source_time', ['source', 'validTime'])
export class RainfallGrid {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  source: string;

  @Index('idx_rainfall_grids_valid_time')
  @Column({ type: 'timestamptz', name: 'valid_time' })
  validTime: Date;

  @Column({ type: 'double precision', name: 'west_lon' })
  westLon: number;

  @Column({ type: 'double precision', name: 'north_lat' })
  northLat: number;

  @Column({ type: 'double precision', name: 'resolution_deg' })
  resolutionDeg: number;

  @Column({ type: 'integer' })
  nx: number;

  @Column({ type: 'integer' })
  ny: number;

  @Column({ type: 'varchar', length: 40 })
  encoding: string;

  @Column({ type: 'bytea' })
  data: Buffer;

  @Column({ type: 'integer', name: 'missing_cells' })
  missingCells: number;

  @Column({ type: 'timestamptz', name: 'retrieved_at' })
  retrievedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
