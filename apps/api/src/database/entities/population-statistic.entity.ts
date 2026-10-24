import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { District } from './district.entity';
import { numericTransformer } from '../transformers/numeric.transformer';
import { AdministrativeLevel } from '../../common/enums/domain.enum';

// One row = one kabupaten/kota's population for one year, sourced from
// Kemendagri (see reference-data.seed.ts). `regionCode` and
// `administrativeLevel` are denormalized off `district` (not just derivable
// through the FK) so every row is self-describing about exactly which
// administrative resolution its `totalPopulation`/`populationDensity`
// apply to — required before any consumer (risk-engine, resource
// optimization, UI) is allowed to treat these numbers as "the population of
// X" without knowing what X actually is. See docs/DATABASE_SCHEMA.md §6.
@Entity('population_statistics')
@Unique(['district', 'year'])
export class PopulationStatistic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => District, (district) => district.populationStatistics, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'varchar', length: 10, name: 'region_code' })
  regionCode: string;

  @Column({
    type: 'enum',
    enum: AdministrativeLevel,
    default: AdministrativeLevel.KABUPATEN_KOTA,
    name: 'administrative_level',
  })
  administrativeLevel: AdministrativeLevel;

  @Column({ type: 'smallint' })
  year: number;

  @Column({
    type: 'bigint',
    name: 'total_population',
    transformer: numericTransformer,
  })
  totalPopulation: number;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    name: 'population_density',
    transformer: numericTransformer,
  })
  populationDensity: number;

  @Column({ type: 'varchar', length: 60, default: 'BPS' })
  source: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
