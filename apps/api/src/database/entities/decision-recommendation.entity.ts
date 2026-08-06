import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PriorityLevel } from '../../common/enums/domain.enum';
import { RiskAssessment } from './risk-assessment.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

export interface DecisionReason {
  factor: string;
  detail: string;
  weight?: number | null;
}

// Replaces `recommendations`. Same structured `reasons` JSONB XAI pattern;
// now carries cascading-hazard factors (docs/DATABASE_SCHEMA.md §18).
@Entity('decision_recommendations')
export class DecisionRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @OneToOne(
    () => RiskAssessment,
    (assessment) => assessment.decisionRecommendation,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'risk_assessment_id' })
  riskAssessment: RiskAssessment;

  @Index()
  @Column({ type: 'enum', enum: PriorityLevel, name: 'priority_level' })
  priorityLevel: PriorityLevel;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'priority_score',
    transformer: numericTransformer,
  })
  priorityScore: number;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    name: 'confidence_score',
    transformer: numericTransformer,
  })
  confidenceScore: number;

  @Column({ type: 'text', name: 'summary_text' })
  summaryText: string;

  @Column({ type: 'jsonb' })
  reasons: DecisionReason[];

  @Column({ type: 'text', nullable: true, name: 'action_recommendation' })
  actionRecommendation: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
