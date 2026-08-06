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
import { HazardType } from '../../common/enums/domain.enum';
import { Province } from './province.entity';
import { District } from './district.entity';
import { User } from './user.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// Generalized from ORION's BNPB-earthquake-only historical table: adds
// `hazard_type` so it becomes a cross-hazard historical record store.
@Entity('historical_disasters')
export class HistoricalDisaster {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: HazardType, name: 'hazard_type' })
  hazardType: HazardType;

  @Index()
  @ManyToOne(() => Province, (province) => province.historicalDisasters)
  @JoinColumn({ name: 'province_id' })
  province: Province;

  @Index()
  @ManyToOne(() => District, (district) => district.historicalDisasters, {
    nullable: true,
  })
  @JoinColumn({ name: 'district_id' })
  district: District | null;

  @Column({ type: 'date', name: 'event_date' })
  eventDate: string;

  // Earthquake only, nullable otherwise.
  @Column({
    type: 'numeric',
    precision: 3,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  magnitude: number | null;

  @Column({ type: 'integer', default: 0, name: 'casualties_dead' })
  casualtiesDead: number;

  @Column({ type: 'integer', default: 0, name: 'casualties_injured' })
  casualtiesInjured: number;

  @Column({ type: 'integer', default: 0, name: 'casualties_missing' })
  casualtiesMissing: number;

  @Column({ type: 'integer', default: 0, name: 'displaced_population' })
  displacedPopulation: number;

  @Column({ type: 'integer', default: 0, name: 'damaged_buildings_count' })
  damagedBuildingsCount: number;

  @Column({ type: 'text', nullable: true, name: 'damage_description' })
  damageDescription: string | null;

  @Column({ type: 'varchar', length: 60, default: 'BNPB' })
  source: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
