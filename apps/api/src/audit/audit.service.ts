import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../database/entities';

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    const row = this.auditLogRepository.create({
      actor: entry.actorUserId ? { id: entry.actorUserId } : null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
    await this.auditLogRepository.save(row);
  }

  async findAll(filters: {
    actorUserId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actor', 'actor')
      .orderBy('log.createdAt', 'DESC');

    if (filters.actorUserId) {
      qb.andWhere('actor.id = :actorUserId', {
        actorUserId: filters.actorUserId,
      });
    }
    if (filters.action) {
      qb.andWhere('log.action = :action', { action: filters.action });
    }
    if (filters.from) {
      qb.andWhere('log.createdAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('log.createdAt <= :to', { to: filters.to });
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { data, meta: { page: filters.page, limit: filters.limit, total } };
  }
}
