import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CvDetectionType } from '../../common/enums/domain.enum';
import { HazardEvent } from './hazard-event.entity';
import { numericTransformer } from '../transformers/numeric.transformer';

// Phase 2 — Computer Vision Engine, schema included now
// (docs/DATABASE_SCHEMA.md §22). No producer populates this table yet.
@Entity('cv_detections')
export class CvDetection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: CvDetectionType, name: 'detection_type' })
  detectionType: CvDetectionType;

  @Index()
  @ManyToOne(() => HazardEvent, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hazard_event_id' })
  hazardEvent: HazardEvent | null;

  // Storage key (S3/MinIO) — see docs/MIGRATION_FROM_ORION.md §storage.
  @Column({ type: 'text', name: 'source_image_ref' })
  sourceImageRef: string;

  // One entry per bounding box (mask_to_detections currently emits exactly
  // one per detection, but the shape allows a future multi-box detector).
  // Typed `unknown[]` rather than a concrete shape since this column is
  // opaque JSON as far as TypeORM/Postgres are concerned — consumers (e.g.
  // field-reports.service.ts) narrow it against DetectCvBoundingBox.
  @Column({ type: 'jsonb', name: 'bounding_boxes' })
  boundingBoxes: unknown[];

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    name: 'confidence_score',
    transformer: numericTransformer,
  })
  confidenceScore: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
