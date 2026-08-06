import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { District } from './district.entity';
import { HistoricalDisaster } from './historical-disaster.entity';

@Entity('provinces')
export class Province {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10, unique: true, name: 'bps_code' })
  bpsCode: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index({ spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'MultiPolygon',
    srid: 4326,
    nullable: true,
  })
  geom: object | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => District, (district) => district.province)
  districts: District[];

  @OneToMany(() => HistoricalDisaster, (record) => record.province)
  historicalDisasters: HistoricalDisaster[];
}
