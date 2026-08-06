import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Generalizes ORION's hospitals-sync tracking pattern to every ingestion
// adapter (docs/DATABASE_SCHEMA.md §24).
@Entity('data_source_syncs')
export class DataSourceSync {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 'bmkg' | 'weather_api' | 'nasa_firms' | 'sentinel' | 'osm'
  @Column({ type: 'varchar', length: 60, unique: true, name: 'source_id' })
  sourceId: string;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_synced_at' })
  lastSyncedAt: Date | null;

  @Column({ type: 'varchar', length: 40, default: 'never_run' })
  status: string;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
