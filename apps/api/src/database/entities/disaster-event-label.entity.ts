import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { District } from './district.entity';

export type DisasterLabelHazard = 'flood' | 'landslide';

/**
 * Reported flood / landslide events used as labels for evaluating the
 * Rainfall Intelligence baselines (docs/RAINFALL_INTELLIGENCE.md,
 * Milestone 7). Mirrors BNPB DIBI one row per (report, hazard): a "Banjir
 * dan Tanah Longsor" report yields one flood and one landslide row.
 *
 * Deliberately separate from `historical_disasters`: that table feeds the
 * dashboard and the risk-engine's historical relevance input, which these
 * thousands of rows must not silently change.
 */
@Entity('disaster_event_labels')
@Index(
  'uq_disaster_event_labels_source_external_hazard',
  ['source', 'externalId', 'hazard'],
  {
    unique: true,
  },
)
@Index('idx_disaster_event_labels_hazard_date', ['hazard', 'localDate'])
export class DisasterEventLabel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 'dibi'
  @Column({ type: 'varchar', length: 20 })
  source: string;

  /** The source's record id. */
  @Column({ type: 'varchar', length: 80, name: 'external_id' })
  externalId: string;

  @Column({ type: 'varchar', length: 20 })
  hazard: DisasterLabelHazard;

  /** The source's own event type, e.g. "Banjir Bandang". */
  @Column({ type: 'varchar', length: 60, name: 'event_type' })
  eventType: string;

  @ManyToOne(() => District, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'uuid', name: 'district_id' })
  districtId: string;

  /** Kemendagri code as published (e.g. "33.27"). */
  @Column({ type: 'varchar', length: 10, name: 'region_code' })
  regionCode: string;

  /** Local calendar date of the event as reported. */
  @Column({ type: 'date', name: 'local_date' })
  localDate: string;

  /** Local time of day as reported; null when only a date was given. */
  @Column({ type: 'time', name: 'local_time', nullable: true })
  localTime: string | null;

  @Column({ type: 'integer', default: 0 })
  dead: number;

  @Column({ type: 'integer', default: 0 })
  missing: number;

  /** "Menderita dan mengungsi" (affected and displaced persons). */
  @Column({ type: 'integer', default: 0, name: 'affected_displaced' })
  affectedDisplaced: number;

  @Column({ type: 'integer', default: 0, name: 'houses_flooded' })
  housesFlooded: number;

  @Column({ type: 'integer', default: 0, name: 'houses_damaged' })
  housesDamaged: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
