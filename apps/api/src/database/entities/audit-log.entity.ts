import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actor: User | null;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 60, nullable: true, name: 'target_type' })
  targetType: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'target_id' })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'inet', nullable: true, name: 'ip_address' })
  ipAddress: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
