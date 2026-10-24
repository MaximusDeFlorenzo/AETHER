import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  District,
  RainfallGrid,
  RainfallModelRun,
  WeatherHourlySample,
} from '../database/entities';
import { GRID_PRODUCT } from './gsmap-ingestion.service';
import {
  chronologicalSplit,
  WeightedRows,
  type SplitCode,
} from './lib/spatial-dataset';
import { domainCell } from './lib/verification';
import {
  loadRainGrids,
  loadWindHistory,
  type DecodedRainGrid,
} from './rain-inputs.store';
import { RainfallEngineClient } from './rainfall-engine.client';
import {
  buildNowcastRequest,
  maxSteeringWindAgeMs,
  NOWCAST_HORIZONS_HOURS,
} from './rainfall-nowcast.service';
import { SPATIAL_NOWCAST_TASK } from './spatial-model.store';
import { getDistrictPoints } from './weather-samples.store';

const HOUR_MS = 60 * 60 * 1000;
// Rolling training window. Older hours add little for a nowcast and would
// make the replay (one engine call per hour) and the payload grow forever.
export const SPATIAL_TRAINING_WINDOW_DAYS = 28;
// Start hours replayed per database load (frames t−1 … t+3 per chunk).
const CHUNK_START_HOURS = 24;
const MIN_START_HOURS = 10;

/**
 * Milestone 5: trains and evaluates the Stage-2 spatial rain nowcast
 * (ai-engine `/train-rain-nowcast-spatial`) on the stored GSMaP history.
 *
 * Every start hour t that has fields at t−1 h and t+1 h is replayed through
 * the live nowcast engine exactly as it would have run at t (fields up to
 * t, model winds valid ≤ t), so the features carry no future data; the
 * label is the field observed at t + h at the district's cell. Hours are
 * split 60/20/20 by time with an embargo at each boundary. The engine fits,
 * scores the test period against every Stage-1 baseline and applies the
 * promotion gate; the run is persisted in `rainfall_model_runs`.
 */
@Injectable()
export class RainfallSpatialModelService {
  private readonly logger = new Logger(RainfallSpatialModelService.name);
  private running = false;

  constructor(
    private readonly engine: RainfallEngineClient,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(RainfallGrid)
    private readonly gridRepository: Repository<RainfallGrid>,
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
    @InjectRepository(RainfallModelRun)
    private readonly runRepository: Repository<RainfallModelRun>,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  /** Returns false if a training run is already in progress. */
  startInBackground(trigger: 'scheduled' | 'manual'): boolean {
    if (this.running) return false;
    void this.train(trigger).catch((error: Error) =>
      this.logger.error(`Spatial model training failed: ${error.message}`),
    );
    return true;
  }

  async train(
    trigger: 'scheduled' | 'manual',
    now: Date = new Date(),
  ): Promise<RainfallModelRun | null> {
    if (this.running) return null;
    this.running = true;
    const run = this.runRepository.create({
      task: SPATIAL_NOWCAST_TASK,
      status: 'failed',
      trigger,
      issuedAt: now,
      modelVersion: null,
      dataSummary: null,
      parameters: { trainingWindowDays: SPATIAL_TRAINING_WINDOW_DAYS },
      results: null,
      promotedHorizons: [],
      warnings: [],
      error: null,
    });
    try {
      await this.execute(run, now);
    } catch (error) {
      run.status = 'failed';
      run.error = (error as Error).message;
      this.logger.error(`Spatial model training failed: ${run.error}`);
    } finally {
      run.completedAt = new Date();
      this.running = false;
    }
    return this.runRepository.save(run);
  }

  private async execute(run: RainfallModelRun, now: Date): Promise<void> {
    const from = new Date(
      now.getTime() - SPATIAL_TRAINING_WINDOW_DAYS * 24 * HOUR_MS,
    );
    const times = await this.gridTimes(from, now);
    const present = new Set(times.map((t) => t.getTime()));
    const starts = times.filter(
      (t) =>
        present.has(t.getTime() - HOUR_MS) &&
        present.has(t.getTime() + HOUR_MS),
    );
    if (starts.length < MIN_START_HOURS) {
      run.status = 'insufficient_data';
      run.warnings.push(
        `${starts.length} usable start hour(s) (fields at t−1, t, t+1 h); at least ${MIN_START_HOURS} needed.`,
      );
      return;
    }

    const maxHorizon = Math.max(...NOWCAST_HORIZONS_HOURS);
    const split = chronologicalSplit(starts, maxHorizon);
    const splitOf = new Map(
      starts.map((t, i) => [t.getTime(), split.splits[i]]),
    );
    const districts = await getDistrictPoints(this.districtRepository);
    const districtById = new Map(districts.map((d) => [d.id, d]));
    const maxWindAgeMs = maxSteeringWindAgeMs(this.config);
    const rows = new WeightedRows();
    let featureNames: string[] = [];
    let threshold = 1;
    let replayed = 0;

    for (let i = 0; i < starts.length; i += CHUNK_START_HOURS) {
      const chunk = starts
        .slice(i, i + CHUNK_START_HOURS)
        .filter((t) => splitOf.get(t.getTime()) !== null);
      if (!chunk.length) continue;
      const first = chunk[0].getTime();
      const last = chunk[chunk.length - 1].getTime();
      const grids = await loadRainGrids(
        this.gridRepository,
        GRID_PRODUCT,
        new Date(first - HOUR_MS),
        new Date(last + maxHorizon * HOUR_MS),
      );
      const byTime = new Map(grids.map((g) => [g.validTime.getTime(), g]));
      const winds = await loadWindHistory(
        this.sampleRepository,
        new Date(first - maxWindAgeMs),
        new Date(last),
      );
      for (const start of chunk) {
        const t = start.getTime();
        const current = byTime.get(t);
        if (!current) continue;
        const response = await this.engine.predictRainNowcast(
          buildNowcastRequest({
            issuedAt: start,
            current,
            previous: byTime.get(t - HOUR_MS) ?? null,
            districts,
            winds,
            maxWindAgeMs,
          }),
        );
        replayed += 1;
        featureNames = response.spatialFeatureNames;
        threshold = response.thresholdMmPerHour;
        const code = splitOf.get(t) as SplitCode;
        for (const point of response.points) {
          const district = districtById.get(point.id);
          if (!district) continue;
          for (const [h, features] of Object.entries(
            point.spatialFeatures ?? {},
          )) {
            if (!features) continue;
            const observedGrid = byTime.get(t + Number(h) * HOUR_MS);
            const observed = observedGrid
              ? observedAt(observedGrid, district.latitude, district.longitude)
              : null;
            if (observed === null) continue;
            rows.add(Number(h), code, observed >= threshold, features);
          }
        }
      }
    }

    const used = starts.filter((t) => splitOf.get(t.getTime()) !== null);
    run.dataSummary = {
      source: GRID_PRODUCT,
      firstStart: starts[0].toISOString(),
      lastStart: starts[starts.length - 1].toISOString(),
      startHours: starts.length,
      startHoursReplayed: replayed,
      embargoedStartHours: split.embargoed,
      splitBoundaries: split.boundaries.map((b) => b.toISOString()),
      rowsBeforeMerge: rows.total(),
      rowsAfterMerge: rows.size,
      districts: districts.length,
    };
    if (!rows.size || !used.length) {
      run.status = 'insufficient_data';
      run.warnings.push('No labelled rows could be built from the window.');
      return;
    }

    const response = await this.engine.trainRainNowcastSpatial({
      issuedAt: now.toISOString(),
      thresholdMmPerHour: threshold,
      featureNames,
      horizonsHours: NOWCAST_HORIZONS_HOURS,
      history: {
        firstStart: starts[0].toISOString(),
        lastStart: starts[starts.length - 1].toISOString(),
        startHours: starts.length,
        embargoedStartHours: split.embargoed,
        splitBoundaries: [
          split.boundaries[0].toISOString(),
          split.boundaries[1].toISOString(),
        ],
      },
      rows: rows.toRows(),
    });
    run.status = 'completed';
    run.modelVersion = response.modelVersion;
    run.parameters = {
      ...run.parameters,
      featureNames: response.featureNames,
      thresholdMmPerHour: threshold,
      gate: response.gate,
      historyDays: response.historyDays,
    };
    run.results = response.horizons;
    run.promotedHorizons = response.horizons
      .filter((h) => h.promoted)
      .map((h) => h.horizonHours);
    this.logger.log(
      `Spatial model ${response.modelVersion}: ${replayed} hour(s), ${rows.size} merged row(s); promoted horizons [${run.promotedHorizons.join(', ')}]`,
    );
  }

  private async gridTimes(from: Date, to: Date): Promise<Date[]> {
    const rows = await this.gridRepository.query<Array<{ valid_time: Date }>>(
      `SELECT valid_time FROM rainfall_grids
       WHERE source = $1 AND valid_time >= $2 AND valid_time <= $3
       ORDER BY valid_time`,
      [GRID_PRODUCT, from, to],
    );
    return rows.map((r) => new Date(r.valid_time));
  }

  async latest() {
    const run = await this.runRepository.findOne({
      where: { task: SPATIAL_NOWCAST_TASK },
      order: { issuedAt: 'DESC' },
    });
    if (!run) {
      throw new NotFoundException('No spatial model training run yet');
    }
    return run;
  }
}

function observedAt(
  grid: DecodedRainGrid,
  latitude: number,
  longitude: number,
): number | null {
  const cell = domainCell(grid.domain, latitude, longitude);
  if (!cell) return null;
  const value = grid.values[cell.line * grid.domain.nx + cell.column];
  return Number.isFinite(value) ? value : null;
}
