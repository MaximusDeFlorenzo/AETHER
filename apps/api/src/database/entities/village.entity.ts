import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Subdistrict } from './subdistrict.entity';
import {
  AdministrativeLevel,
  RegionCodeSystem,
} from '../../common/enums/domain.enum';

// Kelurahan/desa. Real code/name data (Kepmendagri No 300.2.2-2138 Tahun
// 2025, via github.com/cahyadsn/wilayah's db/wilayah.sql — 83,762 rows
// nationwide, verified 2026-09-22). Population lives in
// `village_populations` (CSV import, see docs/DATABASE_SCHEMA.md §6c);
// `geom` is a reference point only (polygon centroid from
// cahyadsn/wilayah_boundaries, see seeds/seed-village-centroids.ts), no
// boundary or area.
@Entity('villages')
export class Village {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Subdistrict, (subdistrict) => subdistrict.villages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'subdistrict_id' })
  subdistrict: Subdistrict;

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
    default: AdministrativeLevel.KELURAHAN_DESA,
    name: 'administrative_level',
  })
  administrativeLevel: AdministrativeLevel;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  name: string;

  // Indexed in the migration as `(geom::geography)` (idx_villages_geog) —
  // every lookup is a metre-radius ST_DWithin.
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  geom: object | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
