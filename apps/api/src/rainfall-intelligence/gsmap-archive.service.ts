import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { District, RainfallPointArchive } from '../database/entities';
import { sampleGsmap } from './lib/gsmap';
import {
  GSMAP_ARCHIVE_PRODUCT,
  addDays,
  archiveDayDir,
  isoDay,
  latestArchiveDay,
  parseIsoDay,
  pickArchiveFiles,
} from './lib/gsmap-archive';
import {
  GsmapFtpProvider,
  type GsmapFtpSession,
} from './providers/gsmap-ftp.provider';
import { getDistrictPoints, type DistrictPoint } from './weather-samples.store';

// Backtest period start (user decision 2026-10-08: hourly archive from
// 2024). Overridable with GSMAP_ARCHIVE_FROM.
export const DEFAULT_GSMAP_ARCHIVE_FROM = '2024-01-01';
// Days fetched per scheduled top-up: the archive grows one day per day, so
// a few days cover restarts and late publication. Each day is 24 files of
// ~2 MB (~1 min over JAXA FTP).
export const DEFAULT_GSMAP_ARCHIVE_DAYS_PER_RUN = 4;
const MAX_CONSECUTIVE_SESSION_FAILURES = 5;
const SESSION_RETRY_DELAY_MS = 30_000;

export interface ArchiveBackfillSummary {
  from: string;
  to: string;
  daysStored: number;
  daysAlreadyComplete: number;
  missingHours: number;
  stoppedReason: string | null;
}

/**
 * Archives hourly GSMaP_Gauge (standard, ver. 8) rainfall at every district
 * point, one UTC day at a time (lib/gsmap-archive.ts). A day is written
 * only after all its files were read, so an interrupted backfill resumes
 * at the first incomplete day. Bulk backfill: `npm run rainfall:archive`
 * (scripts/gsmap-archive-backfill.ts); the scheduler adds recent days.
 */
@Injectable()
export class GsmapArchiveService {
  private readonly logger = new Logger(GsmapArchiveService.name);
  private running = false;

  constructor(
    private readonly ftp: GsmapFtpProvider,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(RainfallPointArchive)
    private readonly archiveRepository: Repository<RainfallPointArchive>,
  ) {}

  isConfigured(): boolean {
    return this.ftp.isConfigured();
  }

  archiveStart(): Date {
    const configured = this.config.get<string>('GSMAP_ARCHIVE_FROM');
    return (
      parseIsoDay(configured ?? DEFAULT_GSMAP_ARCHIVE_FROM) ??
      parseIsoDay(DEFAULT_GSMAP_ARCHIVE_FROM)!
    );
  }

  startInBackground(maxDays?: number): boolean {
    if (this.running || !this.isConfigured()) return false;
    const days =
      maxDays ??
      Number(
        this.config.get('GSMAP_ARCHIVE_DAYS_PER_RUN') ??
          DEFAULT_GSMAP_ARCHIVE_DAYS_PER_RUN,
      );
    void this.backfill({ maxDays: days }).catch((error: Error) =>
      this.logger.error(`GSMaP archive backfill failed: ${error.message}`),
    );
    return true;
  }

  /**
   * Stores missing days in [from, to] (default: archive start → newest
   * published day), oldest first, at most `maxDays` of them, over
   * `connections` parallel FTP sessions (default 1, max 6). Null if a
   * backfill is already running in this process.
   */
  async backfill(
    options: {
      from?: Date;
      to?: Date;
      maxDays?: number;
      connections?: number;
    } = {},
    now: Date = new Date(),
  ): Promise<ArchiveBackfillSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.execute(options, now);
    } finally {
      this.running = false;
    }
  }

  private async execute(
    options: { from?: Date; to?: Date; maxDays?: number; connections?: number },
    now: Date,
  ): Promise<ArchiveBackfillSummary> {
    const from = options.from ?? this.archiveStart();
    const newest = latestArchiveDay(now);
    const to = options.to && options.to < newest ? options.to : newest;
    const points = await getDistrictPoints(this.districtRepository);
    const complete = await this.completeDays(from, to, points.length);
    const pending: Date[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (!complete.has(isoDay(day))) pending.push(day);
    }
    const todo =
      options.maxDays !== undefined
        ? pending.slice(0, Math.max(0, options.maxDays))
        : pending;
    const summary: ArchiveBackfillSummary = {
      from: isoDay(from),
      to: isoDay(to),
      daysStored: 0,
      daysAlreadyComplete: complete.size,
      missingHours: 0,
      stoppedReason: null,
    };
    if (!todo.length || !points.length) return summary;

    // Workers pull days from one queue, each over its own FTP session; a
    // day still being published stops every worker (later days are newer).
    // A failed session (JAXA's FTP drops passive data connections now and
    // then) is reopened after a pause and its day re-queued; a day is only
    // written once complete, so nothing half-read is stored.
    const queue = [...todo];
    const connections = Math.max(1, Math.min(options.connections ?? 1, 6));
    const worker = async () => {
      let failures = 0;
      while (queue.length && !summary.stoppedReason) {
        let current: Date | undefined;
        try {
          await this.ftp.withSession(async (session) => {
            for (current = queue.shift(); current; current = queue.shift()) {
              if (summary.stoppedReason) return;
              const stop = await this.storeDay(
                session,
                current,
                points,
                newest,
                summary,
              );
              failures = 0;
              if (stop) {
                summary.stoppedReason = stop;
                return;
              }
            }
          });
        } catch (error) {
          if (current) queue.unshift(current);
          failures += 1;
          if (failures > MAX_CONSECUTIVE_SESSION_FAILURES) throw error;
          this.logger.warn(
            `GSMaP archive session failed (${(error as Error).message}); retry ${failures}/${MAX_CONSECUTIVE_SESSION_FAILURES}`,
          );
          await this.pause(SESSION_RETRY_DELAY_MS * failures);
        }
      }
    };
    await Promise.all(Array.from({ length: connections }, worker));
    return summary;
  }

  /** Reads one UTC day; returns why the backfill must stop, else null. */
  private async storeDay(
    session: GsmapFtpSession,
    day: Date,
    points: DistrictPoint[],
    newest: Date,
    summary: ArchiveBackfillSummary,
  ): Promise<string | null> {
    const names = await session.listFiles(archiveDayDir(day));
    if (names === null) {
      return `${isoDay(day)} not published yet`;
    }
    const files = pickArchiveFiles(names, day);
    // A recent day still being published: try again later rather than
    // freeze its gaps as missing hours.
    if (files.some((f) => !f) && day >= addDays(newest, -1)) {
      return `${isoDay(day)} only partly published`;
    }
    const hourly = points.map(() => Array<number | null>(24).fill(null));
    const versions = new Set<string>();
    for (const file of files) {
      if (!file) continue;
      const grid = await session.downloadGz(
        `${archiveDayDir(day)}/${file.name}`,
      );
      versions.add(file.version);
      points.forEach((point, i) => {
        hourly[i][file.hour] = sampleGsmap(
          grid,
          point.latitude,
          point.longitude,
        ).precipitationMm;
      });
    }
    const rows = points.map((point, i) => ({
      districtId: point.id,
      product: GSMAP_ARCHIVE_PRODUCT,
      day: isoDay(day),
      hourlyMm: hourly[i],
      missingHours: hourly[i].filter((v) => v === null).length,
      productVersion: [...versions].sort().join(',').slice(0, 20) || 'none',
    }));
    await this.archiveRepository.upsert(rows, ['districtId', 'product', 'day']);
    summary.daysStored += 1;
    summary.missingHours += files.filter((f) => !f).length;
    this.logger.log(
      `GSMaP archive ${isoDay(day)}: ${files.filter(Boolean).length}/24 hourly files, ${points.length} districts`,
    );
    return null;
  }

  /** Overridden in tests. */
  protected pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Days in [from, to] with a row for every district. */
  private async completeDays(
    from: Date,
    to: Date,
    districts: number,
  ): Promise<Set<string>> {
    const rows = await this.archiveRepository.query<Array<{ day: string }>>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM rainfall_point_archive
       WHERE product = $1 AND day BETWEEN $2 AND $3
       GROUP BY day HAVING count(*) >= $4`,
      [GSMAP_ARCHIVE_PRODUCT, isoDay(from), isoDay(to), districts],
    );
    return new Set(rows.map((r) => r.day));
  }

  async status(now: Date = new Date()) {
    const [row] = await this.archiveRepository.query<
      Array<{
        first_day: string | null;
        last_day: string | null;
        days: string;
        missing_hours: string | null;
      }>
    >(
      `SELECT to_char(min(day), 'YYYY-MM-DD') AS first_day,
              to_char(max(day), 'YYYY-MM-DD') AS last_day,
              count(DISTINCT day) AS days,
              sum(missing_hours) AS missing_hours
       FROM rainfall_point_archive WHERE product = $1`,
      [GSMAP_ARCHIVE_PRODUCT],
    );
    const from = this.archiveStart();
    const newest = latestArchiveDay(now);
    const expectedDays =
      Math.round((newest.getTime() - from.getTime()) / 86_400_000) + 1;
    return {
      product: GSMAP_ARCHIVE_PRODUCT,
      configuredFrom: isoDay(from),
      newestPublishedDay: isoDay(newest),
      firstDay: row?.first_day ?? null,
      lastDay: row?.last_day ?? null,
      daysStored: Number(row?.days ?? 0),
      daysExpected: Math.max(0, expectedDays),
      missingDistrictHours: Number(row?.missing_hours ?? 0),
      running: this.running,
      attribution:
        'GSMaP data by Japan Aerospace Exploration Agency (JAXA) — GSMaP_Gauge standard ver. 8',
    };
  }
}
