import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationType } from '../../common/enums/domain.enum';
import { User } from './user.entity';
import { HazardEvent } from './hazard-event.entity';
import { DecisionRecommendation } from './decision-recommendation.entity';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User | null; // null = broadcast to all connected clients

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @ManyToOne(() => HazardEvent, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'related_hazard_event_id' })
  relatedHazardEvent: HazardEvent | null;

  @ManyToOne(() => DecisionRecommendation, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'related_recommendation_id' })
  relatedRecommendation: DecisionRecommendation | null;

  @Index()
  @Column({ type: 'boolean', default: false, name: 'is_read' })
  isRead: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
