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
import { Subdistrict } from './subdistrict.entity';
import { numericTransformer } from '../transformers/numeric.transformer';
import {
  AdministrativeLevel,
  RegionCodeSystem,
} from '../../common/enums/domain.enum';

// Renamed conceptually to "regions" in product copy, kept as `districts` in
// schema. This table is kabupaten/kota (regency/city) level ONLY — confirmed
// by the seed source (Kemendagri's 514-row kabupaten/kota list, see
// reference-data.seed.ts). Finer levels are separate tables: `subdistricts`
// (kecamatan, FK'd to this one) and `villages` (kelurahan/desa, FK'd to
// `subdistricts`) — see docs/DATABASE_SCHEMA.md §5-6b.
//
// `bpsCode`/`bps_code` is a MISNOMER kept only for backward compatibility
// (this column name, and the `bpsCode` field it produces in every existing
// API response and apps/web type, predates this comment and renaming it
// would break that contract). Verified 2026-09-22: every code seeded into
// this column actually comes from Kemendagri's administrative code decree
// (Kepmendagri No 300.2.2-2138 Tahun 2025), never independently
// cross-checked against BPS's own statistical-area code table — see
// `codeSystem` below, which records the true system explicitly rather than
// relying on this column's name. Do not assume `bpsCode` values are
// interchangeable with an authoritative BPS code without a verified mapping.
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
    default: AdministrativeLevel.KABUPATEN_KOTA,
    name: 'administrative_level',
  })
  administrativeLevel: AdministrativeLevel;

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

  @OneToMany(() => Subdistrict, (subdistrict) => subdistrict.district)
  subdistricts: Subdistrict[];
}
