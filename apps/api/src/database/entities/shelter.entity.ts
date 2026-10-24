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

/** `posko`: staffed shelter/command post with capacity; `assembly_point`:
 * open titik kumpul where residents gather before evacuation. */
export type ShelterKind = 'posko' | 'assembly_point';

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

  @Column({ type: 'varchar', length: 20, default: 'posko' })
  kind: ShelterKind;

  @Index({ spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326 })
  geom: object;

  @Column({ type: 'integer' })
  capacity: number;

  @Column({ type: 'integer', default: 0, name: 'current_occupancy' })
  currentOccupancy: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
    name: 'contact_name',
  })
  contactName: string | null;

  @Column({
    type: 'varchar',
    length: 40,
    nullable: true,
    name: 'contact_phone',
  })
  contactPhone: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Inactive (closed) posko are hidden from the citizen portal. */
  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
