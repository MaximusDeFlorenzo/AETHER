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
import { District } from './district.entity';
import { Village } from './village.entity';
import {
  AdministrativeLevel,
  RegionCodeSystem,
} from '../../common/enums/domain.enum';

// Kecamatan. Real code/name data (Kepmendagri No 300.2.2-2138 Tahun 2025,
// via github.com/cahyadsn/wilayah's db/wilayah.sql — 7,285 rows nationwide,
// verified 2026-09-22 against the same source that validated `districts`).
// Deliberately has NO population/area/geometry column: no verified source
// provides them at this level (see AdministrativeLevel's comment in
// domain.enum.ts and docs/DATABASE_SCHEMA.md §6a) — do not add placeholder
// columns for them until real data is sourced and imported.
@Entity('subdistricts')
export class Subdistrict {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => District, (district) => district.subdistricts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({
    type: 'enum',
    enum: RegionCodeSystem,
    default: RegionCodeSystem.KEMENDAGRI,
    name: 'code_system',
  })
  codeSystem: RegionCodeSystem;

  @Column({
    type: 'enum',
    enum: AdministrativeLevel,
    default: AdministrativeLevel.KECAMATAN,
    name: 'administrative_level',
  })
  administrativeLevel: AdministrativeLevel;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Village, (village) => village.subdistrict)
  villages: Village[];
}
