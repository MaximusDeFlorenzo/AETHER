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

@Entity('shelters')
export class Shelter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => District)
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Index({ spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326 })
  geom: object;

  @Column({ type: 'integer' })
  capacity: number;

  @Column({ type: 'integer', default: 0, name: 'current_occupancy' })
  currentOccupancy: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
