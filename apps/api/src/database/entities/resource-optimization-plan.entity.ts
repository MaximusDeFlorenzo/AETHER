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
import { HazardEvent } from './hazard-event.entity';
import { RiskAssessment } from './risk-assessment.entity';

// Evolves ORION's hospitals/resource_estimates pattern into evacuation/
// logistics/shelter planning (docs/DATABASE_SCHEMA.md §20).
@Entity('resource_optimization_plans')
export class ResourceOptimizationPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => District)
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Index()
  @ManyToOne(() => HazardEvent, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent | null;

  @ManyToOne(() => RiskAssessment, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'risk_assessment_id' })
  riskAssessment: RiskAssessment | null;

  // 'evacuation' | 'shelter_allocation' | 'logistics'
  @Column({ type: 'varchar', length: 60, name: 'plan_type' })
  planType: string;

  // Routes, capacities, resource breakdown.
  @Column({ type: 'jsonb', name: 'plan_details' })
  planDetails: Record<string, unknown>;

  @Column({
    type: 'integer',
    nullable: true,
    name: 'estimated_personnel_needed',
  })
  estimatedPersonnelNeeded: number | null;

  @Column({ type: 'varchar', length: 40, default: 'draft' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
