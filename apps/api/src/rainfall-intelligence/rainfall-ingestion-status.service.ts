import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DataSourceSync } from '../database/entities';
import { GsmapIngestionService } from './gsmap-ingestion.service';
import { RainfallIngestionService } from './rainfall-ingestion.service';
import {
  GSMAP_SYNC_SOURCE_ID,
  RAINFALL_SYNC_SOURCE_ID,
} from './rainfall.constants';

const HOUR_MS = 60 * 60 * 1000;

/**
 * One view of both rainfall ingestions: sync status (`data_source_syncs`),
 * whether a run is in progress, the last run's summary (in-memory, so empty
 * after an API restart), and what the table actually holds per source over
 * the last 24 h.
 */
@Injectable()
export class RainfallIngestionStatusService {
  constructor(
    private readonly openMeteo: RainfallIngestionService,
    private readonly gsmap: GsmapIngestionService,
    @InjectRepository(DataSourceSync)
    private readonly syncRepository: Repository<DataSourceSync>,
  ) {}

  async getStatus(now: Date = new Date()) {
    const syncs = await this.syncRepository.find({
      where: { sourceId: In([RAINFALL_SYNC_SOURCE_ID, GSMAP_SYNC_SOURCE_ID]) },
    });
    const sync = (sourceId: string) => {
      const row = syncs.find((s) => s.sourceId === sourceId);
      return row
        ? {
            status: row.status,
            lastSyncedAt: row.lastSyncedAt,
            errorMessage: row.errorMessage,
          }
        : { status: 'never_run', lastSyncedAt: null, errorMessage: null };
    };
    const coverage = await this.syncRepository.query<
      Array<{
        source: string;
        latest_valid_time: Date;
        hours: string;
        samples: string;
        null_precipitation: string;
      }>
    >(
      `SELECT source,
              MAX(valid_time) AS latest_valid_time,
              COUNT(DISTINCT valid_time) AS hours,
              COUNT(*) AS samples,
              COUNT(*) FILTER (WHERE precipitation_mm IS NULL) AS null_precipitation
       FROM weather_hourly_samples
       WHERE valid_time > $1
       GROUP BY source
       ORDER BY source`,
      [new Date(now.getTime() - 24 * HOUR_MS)],
    );

    return {
      generatedAt: now.toISOString(),
      sources: {
        openMeteo: {
          configured: true,
          running: this.openMeteo.isRunning(),
          sync: sync(RAINFALL_SYNC_SOURCE_ID),
          lastRun: this.openMeteo.getLastSummary(),
        },
        gsmapNow: {
          configured: this.gsmap.isConfigured(),
          running: this.gsmap.isRunning(),
          sync: sync(GSMAP_SYNC_SOURCE_ID),
          lastRun: this.gsmap.getLastSummary(),
        },
      },
      storedLast24h: coverage.map((row) => ({
        source: row.source,
        latestValidTime: row.latest_valid_time,
        hours: Number(row.hours),
        samples: Number(row.samples),
        nullPrecipitation: Number(row.null_precipitation),
      })),
    };
  }
}
