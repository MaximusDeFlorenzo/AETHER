import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DisasterEventLabel, District } from '../database/entities';
import {
  DIBI_SOURCE,
  dibiRowToLabels,
  type DibiSkipReason,
  type DisasterLabelDraft,
} from './lib/dibi';
import { DibiClient } from './providers/dibi.client';

// First year imported (overridable with DIBI_LABELS_FROM_YEAR): the hourly
// rain archive starts 2024-01-01, and 2023 gives climatology / persistence
// baselines a year before it.
export const DEFAULT_DIBI_LABELS_FROM_YEAR = 2023;
const UPSERT_CHUNK = 1000;

export interface LabelImportSummary {
  years: number[];
  rowsFetched: number;
  labelsUpserted: number;
  labelsRemoved: number;
  skipped: Record<DibiSkipReason, number>;
}

/**
 * Mirrors BNPB DIBI flood / landslide reports into `disaster_event_labels`
 * (lib/dibi.ts). Each imported year is replaced as a whole — upserted on
 * (source, external id, hazard), and labels DIBI no longer lists for that
 * year are removed — because DIBI corrects and merges reports after the
 * fact. Scheduled runs re-import only the current and previous year.
 */
@Injectable()
export class DisasterLabelsService {
  private readonly logger = new Logger(DisasterLabelsService.name);
  private running = false;
  private lastImport: { at: Date; summary: LabelImportSummary } | null = null;

  constructor(
    private readonly dibi: DibiClient,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(DisasterEventLabel)
    private readonly labelRepository: Repository<DisasterEventLabel>,
  ) {}

  fromYear(): number {
    const value = Number(
      this.config.get('DIBI_LABELS_FROM_YEAR') ?? DEFAULT_DIBI_LABELS_FROM_YEAR,
    );
    return Number.isInteger(value) && value >= 2000
      ? value
      : DEFAULT_DIBI_LABELS_FROM_YEAR;
  }

  /** Full import when the table is empty, else the last two years. */
  startInBackground(options: { full?: boolean } = {}): boolean {
    if (this.running) return false;
    void (async () => {
      const now = new Date();
      const existing = await this.labelRepository.count({
        where: { source: DIBI_SOURCE },
      });
      const thisYear = now.getUTCFullYear();
      const first =
        options.full || existing === 0
          ? this.fromYear()
          : Math.max(this.fromYear(), thisYear - 1);
      await this.import(first, thisYear);
    })().catch((error: Error) =>
      this.logger.error(`DIBI label import failed: ${error.message}`),
    );
    return true;
  }

  async import(
    fromYear: number,
    toYear: number,
  ): Promise<LabelImportSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const summary = await this.execute(fromYear, toYear);
      this.lastImport = { at: new Date(), summary };
      this.logger.log(
        `DIBI labels ${fromYear}–${toYear}: ${summary.rowsFetched} reports → ${summary.labelsUpserted} labels (${summary.labelsRemoved} removed)`,
      );
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async execute(
    fromYear: number,
    toYear: number,
  ): Promise<LabelImportSummary> {
    const codes = await this.districtRepository
      .createQueryBuilder('d')
      .select('d.id', 'id')
      .addSelect('d.bps_code', 'code')
      .getRawMany<{ id: string; code: string }>();
    const districtIdByCode = new Map(codes.map((c) => [c.code, c.id]));
    const summary: LabelImportSummary = {
      years: [],
      rowsFetched: 0,
      labelsUpserted: 0,
      labelsRemoved: 0,
      skipped: { not_rain_driven: 0, unknown_region: 0, bad_timestamp: 0 },
    };

    for (let year = fromYear; year <= toYear; year++) {
      const rows = await this.dibi.fetchYear(year);
      const labels: DisasterLabelDraft[] = [];
      for (const row of rows) {
        const result = dibiRowToLabels(row, districtIdByCode);
        if (typeof result === 'string') summary.skipped[result] += 1;
        else labels.push(...result);
      }
      for (let i = 0; i < labels.length; i += UPSERT_CHUNK) {
        await this.labelRepository.upsert(labels.slice(i, i + UPSERT_CHUNK), [
          'source',
          'externalId',
          'hazard',
        ]);
      }
      const keep = labels.map((l) => `${l.externalId}:${l.hazard}`);
      const removed = await this.labelRepository.query<[unknown, number]>(
        `DELETE FROM disaster_event_labels
         WHERE source = $1
           AND local_date >= make_date($2, 1, 1)
           AND local_date < make_date($2 + 1, 1, 1)
           AND NOT ((external_id || ':' || hazard) = ANY($3::text[]))`,
        [DIBI_SOURCE, year, keep],
      );
      summary.years.push(year);
      summary.rowsFetched += rows.length;
      summary.labelsUpserted += labels.length;
      summary.labelsRemoved += Array.isArray(removed) ? Number(removed[1]) : 0;
    }
    return summary;
  }

  async summary() {
    const rows = await this.labelRepository.query<
      Array<{
        hazard: string;
        year: number;
        labels: string;
        districts: string;
        date_only: string;
        last_date: string;
      }>
    >(
      `SELECT hazard, extract(year FROM local_date)::int AS year,
              count(*) AS labels, count(DISTINCT district_id) AS districts,
              count(*) FILTER (WHERE local_time IS NULL) AS date_only,
              to_char(max(local_date), 'YYYY-MM-DD') AS last_date
       FROM disaster_event_labels WHERE source = $1
       GROUP BY hazard, year ORDER BY hazard, year`,
      [DIBI_SOURCE],
    );
    return {
      source: DIBI_SOURCE,
      attribution:
        'BNPB — Data dan Informasi Bencana Indonesia (DIBI), dibi.bnpb.go.id',
      caveat:
        'Reported events only: an unreported event is absent, and dates/times are as reported (local wall-clock time, ~10 % date only).',
      byHazardYear: rows.map((r) => ({
        hazard: r.hazard,
        year: r.year,
        labels: Number(r.labels),
        districts: Number(r.districts),
        dateOnly: Number(r.date_only),
        lastDate: r.last_date,
      })),
      running: this.running,
      lastImport: this.lastImport,
    };
  }
}
