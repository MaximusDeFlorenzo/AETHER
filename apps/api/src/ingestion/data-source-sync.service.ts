import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSourceSync } from '../database/entities';

/**
 * Generalizes ORION's `hospitals.scheduler.ts`/`hospital-sync.service.ts`
 * status-tracking pattern (docs/DATABASE_SCHEMA.md §24) to every ingestion
 * adapter, not just one third-party directory.
 */
@Injectable()
export class DataSourceSyncService {
  constructor(
    @InjectRepository(DataSourceSync)
    private readonly dataSourceSyncRepository: Repository<DataSourceSync>,
  ) {}

  async getLastSyncedAt(sourceId: string): Promise<Date | null> {
    const row = await this.dataSourceSyncRepository.findOne({
      where: { sourceId },
    });
    return row?.lastSyncedAt ?? null;
  }

  async recordSuccess(sourceId: string): Promise<void> {
    await this.upsert(sourceId, {
      status: 'success',
      lastSyncedAt: new Date(),
      errorMessage: null,
    });
  }

  async recordFailure(sourceId: string, errorMessage: string): Promise<void> {
    await this.upsert(sourceId, { status: 'failed', errorMessage });
  }

  private async upsert(
    sourceId: string,
    patch: Partial<
      Pick<DataSourceSync, 'status' | 'lastSyncedAt' | 'errorMessage'>
    >,
  ): Promise<void> {
    const existing = await this.dataSourceSyncRepository.findOne({
      where: { sourceId },
    });
    if (existing) {
      await this.dataSourceSyncRepository.save({ ...existing, ...patch });
      return;
    }
    await this.dataSourceSyncRepository.save(
      this.dataSourceSyncRepository.create({ sourceId, ...patch }),
    );
  }
}
