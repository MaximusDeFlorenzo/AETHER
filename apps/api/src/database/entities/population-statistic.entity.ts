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
