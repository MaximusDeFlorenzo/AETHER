import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Archived hourly rainfall at each district point, one row per UTC day
 * (docs/RAINFALL_INTELLIGENCE.md, Milestone 7). Holds only the cell under
 * each point — the global grids are read once and discarded — so years of
 * history stay a few hundred thousand rows.
 *
 * `hourlyMm[h]` is the hour h:00–h:59 UTC of `day`, i.e. the hour whose
 * `valid_time` (window end) is day + h + 1 h. Null = missing.
 */
@Entity('rainfall_point_archive')
@Index('idx_rainfall_point_archive_product_day', ['product', 'day'])
export class RainfallPointArchive {
  @PrimaryColumn({ type: 'uuid', name: 'district_id' })
  districtId: string;

  // 'gsmap_gauge_v8' (GSMaP_Gauge standard, JAXA)
  @PrimaryColumn({ type: 'varchar', length: 30 })
  product: string;

  @PrimaryColumn({ type: 'date' })
  day: string;

  @Column({ type: 'real', array: true, name: 'hourly_mm' })
  hourlyMm: Array<number | null>;

  @Column({ type: 'smallint', name: 'missing_hours' })
  missingHours: number;

  /** Algorithm version from the file names, e.g. "v8.1000.0". */
  @Column({ type: 'varchar', length: 20, name: 'product_version' })
  productVersion: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
