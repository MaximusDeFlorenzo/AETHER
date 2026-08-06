import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ExposureLevel,
  HazardType,
  RiskAssessmentStatus,
} from '../../common/enums/domain.enum';
import { HazardEvent } from './hazard-event.entity';
import { District } from './district.entity';
import { DecisionRecommendation } from './decision-recommendation.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// Replaces `predictions`. `hazardEvent` is nullable — null means a
// standing/baseline periodic risk score for a region with no active event,
// the core prediction/prevention differentiator vs. ORION's reactive-only
// model (docs/DATABASE_SCHEMA.md §17).
@Entity('risk_assessments')
export class RiskAssessment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => HazardEvent, (event) => event.riskAssessments, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent | null;

  @Column({ type: 'enum', enum: HazardType, name: 'hazard_type' })
  hazardType: HazardType;

  @Index()
  @ManyToOne(() => District)
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'risk_score',
    transformer: numericTransformer,
  })
  riskScore: number;

  @Column({
    type: 'enum',
    enum: ExposureLevel,
    nullable: true,
    name: 'exposure_level',
  })
  exposureLevel: ExposureLevel | null;

  @Column({
    type: 'bigint',
    nullable: true,
    name: 'estimated_affected_population',
    transformer: numericTransformer,
  })
  estimatedAffectedPopulation: number | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    nullable: true,
    name: 'confidence_score',
    transformer: numericTransformer,
  })
  confidenceScore: number | null;

  @Column({
    type: 'varchar',
    length: 40,
    nullable: true,
    name: 'model_version',
  })
  modelVersion: string | null;

  // Exact payload sent to ai-engine (auditability).
  @Column({ type: 'jsonb', name: 'input_snapshot' })
  inputSnapshot: Record<string, unknown>;

  @Index()
  @Column({
    type: 'enum',
    enum: RiskAssessmentStatus,
    default: RiskAssessmentStatus.PENDING,
  })
  status: RiskAssessmentStatus;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'assessed_at' })
  assessedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(
    () => DecisionRecommendation,
    (recommendation) => recommendation.riskAssessment,
  )
  decisionRecommendation: DecisionRecommendation;
}
