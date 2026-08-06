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
import { HazardRelationshipType } from '../../common/enums/domain.enum';
import { HazardEvent } from './hazard-event.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// New — the direct implementation of "model relationships between hazards
// instead of treating them independently" (docs/DATABASE_SCHEMA.md §16).
// Written by spatial-intelligence/ when it detects a plausible cascading
// link (e.g. an earthquake followed by a landslide in the same region
// within a correlation window).
@Entity('hazard_relationships')
@Unique(['sourceEvent', 'relatedEvent', 'relationshipType'])
export class HazardRelationship {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => HazardEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_event_id' })
  sourceEvent: HazardEvent;

  @Index()
  @ManyToOne(() => HazardEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'related_event_id' })
  relatedEvent: HazardEvent;

  @Column({
    type: 'enum',
    enum: HazardRelationshipType,
    name: 'relationship_type',
  })
  relationshipType: HazardRelationshipType;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    name: 'confidence_score',
    transformer: numericTransformer,
  })
  confidenceScore: number;

  @Column({
    type: 'varchar',
    length: 60,
    default: 'spatial_intelligence_engine',
    name: 'detected_by',
  })
  detectedBy: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
