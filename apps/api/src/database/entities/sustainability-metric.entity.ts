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

@Entity('sustainability_metrics')
@Unique(['district', 'periodStart', 'periodEnd'])
export class SustainabilityMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => District)
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'date', name: 'period_start' })
  periodStart: string;

  @Column({ type: 'date', name: 'period_end' })
  periodEnd: string;

  @Column({ type: 'jsonb', name: 'sdg_indicators', default: {} })
  sdgIndicators: Record<string, unknown>;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    name: 'climate_resilience_score',
    transformer: numericTransformer,
  })
  climateResilienceScore: number | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    name: 'carbon_reduction_estimate',
    transformer: numericTransformer,
  })
  carbonReductionEstimate: number | null;

  @Column({
    type: 'bigint',
    nullable: true,
    name: 'protected_population',
    transformer: numericTransformer,
  })
  protectedPopulation: number | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    name: 'response_efficiency_score',
    transformer: numericTransformer,
  })
  responseEfficiencyScore: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
