import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { District, DistrictHazardIndex } from '../database/entities';
import {
  BNPB_LAYER_FLOOD_HAZARD_INDEX,
  BnpbInariskClient,
} from '../ingestion/adapters/bnpb-inarisk.client';
import { hazardSamplePoints, summarizeHazardSamples } from './lib/flood-inputs';
import { getDistrictPoints, type DistrictPoint } from './weather-samples.store';

export const HAZARD_INDEX_SOURCE = 'bnpb_inarisk';
// ~5.5 km: far enough that the five samples are not the same few pixels of
// a 100 m raster, close enough to stay near the district's settlement.
export const HAZARD_SAMPLE_OFFSET_DEG = 0.05;
// The InaRISK layers are static national products; re-sampling monthly
// only catches republished layers.
export const HAZARD_INDEX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Polite to a public government server: a full refresh is 514 × 5 lookups.
const CONCURRENCY = 6;

export interface HazardIndexRefreshSummary {
  layer: string;
  districtsSampled: number;
  districtsSkipped: number;
  districtsWithData: number;
  /** Some lookup failed; not stored, retried next refresh. */
  districtsFailed: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * Samples BNPB InaRISK hazard-index rasters around every kabupaten/kota
 * point into `district_hazard_indices` (docs/RAINFALL_INTELLIGENCE.md,
 * Milestone 3). Only districts never sampled or sampled more than
 * HAZARD_INDEX_MAX_AGE_MS ago are fetched, so calling this on every
 * startup costs one query once the table is filled. A district is stored
 * only when all five lookups were answered (a value or NoData); if any
 * request failed it stays unsampled and is retried on the next refresh.
 */
@Injectable()
export class DistrictHazardIndexService {
  private readonly logger = new Logger(DistrictHazardIndexService.name);
  private running = false;

  constructor(
    private readonly bnpb: BnpbInariskClient,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(DistrictHazardIndex)
    private readonly indexRepository: Repository<DistrictHazardIndex>,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  /** Returns false if a refresh is already running. */
  startInBackground(layer = BNPB_LAYER_FLOOD_HAZARD_INDEX): boolean {
    if (this.running) return false;
    void this.refresh(layer).catch((error: Error) =>
      this.logger.error(`Hazard index refresh failed: ${error.message}`),
    );
    return true;
  }

  async refresh(
    layer = BNPB_LAYER_FLOOD_HAZARD_INDEX,
    now: Date = new Date(),
  ): Promise<HazardIndexRefreshSummary | null> {
    if (this.running) return null;
    this.running = true;
    const startedAt = new Date();
    try {
      const districts = await getDistrictPoints(this.districtRepository);
      const fresh = await this.freshDistrictIds(layer, now);
      const due = districts.filter((d) => !fresh.has(d.id));
      let withData = 0;
      let failed = 0;
      for (let i = 0; i < due.length; i += CONCURRENCY) {
        const batch = due.slice(i, i + CONCURRENCY);
        const sampled = await Promise.all(
          batch.map((district) => this.sample(layer, district, now)),
        );
        const rows = sampled.filter(
          (r): r is Partial<DistrictHazardIndex> => r !== null,
        );
        failed += sampled.length - rows.length;
        withData += rows.filter((r) => (r.samplesValid ?? 0) > 0).length;
        if (rows.length === 0) continue;
        await this.indexRepository
          .createQueryBuilder()
          .insert()
          .into(DistrictHazardIndex)
          .values(rows)
          .orUpdate(
            [
              'source',
              'value_mean',
              'value_max',
              'value_center',
              'samples_total',
              'samples_valid',
              'sample_offset_deg',
              'sampled_at',
            ],
            ['district_id', 'layer'],
          )
          .execute();
      }
      const summary = {
        layer,
        districtsSampled: due.length,
        districtsSkipped: districts.length - due.length,
        districtsWithData: withData,
        districtsFailed: failed,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
      };
      if (due.length > 0) {
        this.logger.log(
          `Hazard index ${layer}: ${due.length - failed} district(s) sampled (${withData} with data), ${failed} failed`,
        );
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  /** district id → stored summary for a layer. */
  async load(
    layer = BNPB_LAYER_FLOOD_HAZARD_INDEX,
  ): Promise<Map<string, DistrictHazardIndex>> {
    const rows = await this.indexRepository
      .createQueryBuilder('i')
      .leftJoin('i.district', 'district')
      .addSelect('district.id')
      .where('i.layer = :layer', { layer })
      .getMany();
    return new Map(rows.map((row) => [row.district.id, row]));
  }

  private async freshDistrictIds(layer: string, now: Date) {
    const rows = await this.indexRepository.query<
      Array<{ district_id: string }>
    >(
      `SELECT district_id FROM district_hazard_indices
       WHERE layer = $1 AND sampled_at > $2`,
      [layer, new Date(now.getTime() - HAZARD_INDEX_MAX_AGE_MS)],
    );
    return new Set(rows.map((r) => r.district_id));
  }

  private async sample(
    layer: string,
    district: DistrictPoint,
    now: Date,
  ): Promise<Partial<DistrictHazardIndex> | null> {
    const lookups = await Promise.all(
      hazardSamplePoints(
        district.latitude,
        district.longitude,
        HAZARD_SAMPLE_OFFSET_DEG,
      ).map((p) => this.bnpb.lookupIndexValue(layer, p.longitude, p.latitude)),
    );
    if (lookups.some((l) => l.failed)) return null;
    const values = lookups.map((l) => l.value);
    return {
      district: { id: district.id } as District,
      layer,
      source: HAZARD_INDEX_SOURCE,
      ...summarizeHazardSamples(values),
      sampleOffsetDeg: HAZARD_SAMPLE_OFFSET_DEG,
      sampledAt: now,
    };
  }
}
