import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { HazardEvent, KarhutlaPredictionRun, User } from '../database/entities';
import { HazardType } from '../common/enums/domain.enum';
import { KarhutlaRunStatus, KarhutlaRunTrigger } from './karhutla.enums';
import {
  ABANDONED_RUN_MINUTES,
  DEFAULT_HORIZONS_HOURS,
  KARHUTLA_PREDICTION_QUEUE,
} from './karhutla.constants';
import { toRunView, type HotspotPoint } from './lib/views';
import { verifyForecast } from './lib/verification';
import type { PolygonalGeometry } from './lib/geo';

export interface KarhutlaJobPayload {
  runId: string;
}

const ACTIVE = [KarhutlaRunStatus.QUEUED, KarhutlaRunStatus.RUNNING];
const FINISHED = [KarhutlaRunStatus.COMPLETED, KarhutlaRunStatus.PARTIAL];
const UNIQUE_VIOLATION = '23505';

/** Run lifecycle for the controller and scheduler: request (idempotent),
 * list, read, verify. The heavy work lives in KarhutlaPipelineService and
 * only ever runs inside the BullMQ job. */
@Injectable()
export class KarhutlaPredictionService {
  private readonly logger = new Logger(KarhutlaPredictionService.name);

  constructor(
    @InjectRepository(KarhutlaPredictionRun)
    private readonly runRepository: Repository<KarhutlaPredictionRun>,
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectQueue(KARHUTLA_PREDICTION_QUEUE)
    private readonly queue: Queue<KarhutlaJobPayload>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Queues a run unless one is already queued/running, in which case that
   * run is returned with `deduplicated: true`. The DB's partial unique index
   * backs this up when two requests race past the lookup.
   */
  async requestRun(options: {
    trigger: KarhutlaRunTrigger;
    userId?: string | null;
    horizonsHours?: number[];
    maxClusters?: number;
  }): Promise<{ run: ReturnType<typeof toRunView>; deduplicated: boolean }> {
    await this.reapAbandonedRuns();
    const active = await this.runRepository.findOne({
      where: { status: In(ACTIVE) },
    });
    if (active) return { run: toRunView(active, false), deduplicated: true };

    let run: KarhutlaPredictionRun;
    try {
      run = await this.runRepository.save(
        this.runRepository.create({
          status: KarhutlaRunStatus.QUEUED,
          trigger: options.trigger,
          requestedBy: options.userId ? ({ id: options.userId } as User) : null,
          horizonsHours: [
            ...(options.horizonsHours ?? DEFAULT_HORIZONS_HOURS),
          ].sort((a, b) => a - b),
          maxClusters:
            options.maxClusters ??
            this.config.get<number>('KARHUTLA_MAX_CLUSTERS') ??
            8,
          hotspotWindowHours:
            this.config.get<number>('KARHUTLA_HOTSPOT_WINDOW_HOURS') ?? 24,
          warnings: [],
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        const winner = await this.runRepository.findOne({
          where: { status: In(ACTIVE) },
        });
        if (winner)
          return { run: toRunView(winner, false), deduplicated: true };
      }
      throw error;
    }

    try {
      await this.queue.add(
        'run',
        { runId: run.id },
        {
          jobId: run.id,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      await this.runRepository.update(run.id, {
        status: KarhutlaRunStatus.FAILED,
        error: `Could not enqueue job: ${(error as Error).message}`,
        completedAt: new Date(),
      });
      throw new ServiceUnavailableException('Prediction queue unavailable');
    }
    return { run: toRunView(run, false), deduplicated: false };
  }

  /** A worker that died mid-job without BullMQ's failure handler firing
   * would otherwise block every future run. */
  async reapAbandonedRuns(): Promise<number> {
    const cutoff = new Date(Date.now() - ABANDONED_RUN_MINUTES * 60_000);
    const result = await this.runRepository.update(
      { status: In(ACTIVE), createdAt: LessThan(cutoff) },
      {
        status: KarhutlaRunStatus.FAILED,
        error: `Abandoned: not completed within ${ABANDONED_RUN_MINUTES} minutes`,
        completedAt: new Date(),
      },
    );
    if (result.affected)
      this.logger.warn(
        `Marked ${result.affected} abandoned karhutla run(s) failed`,
      );
    return result.affected ?? 0;
  }

  async listRuns(limit: number) {
    const runs = await this.runRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return runs.map((run) => toRunView(run, false));
  }

  private findRunWithForecasts(where: Record<string, unknown>) {
    return this.runRepository.findOne({
      where,
      relations: { forecasts: { nearestDistrict: true } },
      order: { createdAt: 'DESC' },
    });
  }

  /** Positions of the observed hotspots behind each forecast, for the map
   * (forecasts persist ids only; hazard_events stays the source of truth). */
  private async loadHotspots(
    run: KarhutlaPredictionRun,
  ): Promise<Map<string, HotspotPoint>> {
    const ids = (run.forecasts ?? []).flatMap((f) => f.hotspotEventIds);
    if (!ids.length) return new Map();
    const events = await this.hazardEventRepository.find({
      where: { id: In(ids) },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        eventTime: true,
        rawPayload: true,
      },
    });
    const num = (v: unknown) => {
      const n = Number.parseFloat(String(v ?? ''));
      return Number.isFinite(n) ? n : null;
    };
    return new Map(
      events.map((e) => {
        const confidencePct = num(e.rawPayload?.confidence);
        return [
          e.id,
          {
            id: e.id,
            latitude: e.latitude,
            longitude: e.longitude,
            observedAt: e.eventTime,
            frpMw: num(e.rawPayload?.frp),
            confidence: confidencePct === null ? null : confidencePct / 100,
          },
        ];
      }),
    );
  }

  async getRun(id: string) {
    const run = await this.findRunWithForecasts({ id });
    if (!run)
      throw new NotFoundException(`Karhutla prediction run ${id} not found`);
    return toRunView(run, true, await this.loadHotspots(run));
  }

  /** Latest finished run plus whether a newer one is in progress. */
  async getLatest() {
    const [run, active] = await Promise.all([
      this.findRunWithForecasts({ status: In(FINISHED) }),
      this.runRepository.findOne({ where: { status: In(ACTIVE) } }),
    ]);
    return {
      run: run ? toRunView(run, true, await this.loadHotspots(run)) : null,
      activeRun: active ? toRunView(active, false) : null,
    };
  }

  /** Observed-vs-predicted spot check against hotspots detected after the
   * run was issued (see lib/verification.ts for what this does NOT show). */
  async verifyRun(id: string) {
    const run = await this.findRunWithForecasts({ id });
    if (!run)
      throw new NotFoundException(`Karhutla prediction run ${id} not found`);
    if (!run.issuedAt) return { runId: id, issuedAt: null, clusters: [] };

    const maxHorizon = Math.max(...run.horizonsHours);
    const windowEnd = new Date(run.issuedAt.getTime() + maxHorizon * 3_600_000);
    const later = await this.hazardEventRepository.find({
      where: {
        hazardType: HazardType.WILDFIRE,
        source: 'nasa_firms',
        eventTime: MoreThan(run.issuedAt),
      },
      select: { id: true, latitude: true, longitude: true, eventTime: true },
    });
    const laterHotspots = later
      .filter((e) => e.eventTime <= windowEnd)
      .map((e) => ({
        id: e.id,
        latitude: e.latitude,
        longitude: e.longitude,
        observedAt: e.eventTime,
      }));

    const now = new Date();
    return {
      runId: id,
      issuedAt: run.issuedAt,
      method:
        'Share of NEW FIRMS hotspots (after issue time, within 30 km) inside the spread envelope vs. inside the observed footprint (persistence baseline). Sparse point samples — not perimeter validation, not an accuracy score.',
      clusters: [...(run.forecasts ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((forecast) => {
          const spread = forecast.spread as {
            observedFootprintAreaKm2?: number;
            horizons?: Array<{
              horizonHours: number;
              validAt: string;
              status: string;
              envelope: PolygonalGeometry | null;
              areaKm2: number | null;
            }>;
          } | null;
          return {
            forecastId: forecast.id,
            rank: forecast.rank,
            horizons: verifyForecast({
              issuedAt: run.issuedAt!,
              now,
              centroid: {
                latitude: forecast.latitude,
                longitude: forecast.longitude,
              },
              clusterHotspotIds: forecast.hotspotEventIds,
              baseline: forecast.observedFootprint as PolygonalGeometry | null,
              baselineAreaKm2: spread?.observedFootprintAreaKm2 ?? null,
              horizons: spread?.horizons ?? [],
              laterHotspots,
            }),
          };
        }),
    };
  }
}
