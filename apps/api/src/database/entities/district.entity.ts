import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Province } from './province.entity';
import { PopulationStatistic } from './population-statistic.entity';
import { HistoricalDisaster } from './historical-disaster.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// Renamed conceptually to "regions" in product copy, kept as `districts` in
// schema — same BPS administrative-code granularity ORION already validated.
@Entity('districts')
export class District {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Province, (province) => province.districts)
  @JoinColumn({ name: 'province_id' })
  province: Province;

  @Column({ type: 'varchar', length: 10, unique: true, name: 'bps_code' })
  bpsCode: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index({ spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Geometry',
    srid: 4326,
  })
  geom: object;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'area_km2',
    transformer: numericTransformer,
  })
  areaKm2: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => PopulationStatistic, (stat) => stat.district)
  populationStatistics: PopulationStatistic[];

  @OneToMany(() => HistoricalDisaster, (record) => record.district)
  historicalDisasters: HistoricalDisaster[];
}
