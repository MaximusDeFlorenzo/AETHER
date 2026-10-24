import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  DisasterEventLabel,
  District,
  RainfallModelRun,
  RainfallPointArchive,
} from '../database/entities';
import { BNPB_LAYER_FLOOD_HAZARD_INDEX } from '../ingestion/adapters/bnpb-inarisk.client';
import { DistrictHazardIndexService } from './district-hazard-index.service';
import { DistrictTerrainService } from './district-terrain.service';
import {
  BACKTEST_LEAD_DAYS,
  dayChunks,
  eventMatrix,
  float32ToBase64,
  int8ToBase64,
  rainSeries,
  utcOffsetForRegionCode,
} from './lib/backtest-inputs';
import { DIBI_SOURCE } from './lib/dibi';
import { nationalTerciles } from './lib/flood-inputs';
import {
  GSMAP_ARCHIVE_PRODUCT,
  addDays,
  isoDay,
  parseIsoDay,
} from './lib/gsmap-archive';
import { RainfallEngineClient } from './rainfall-engine.client';

export const HAZARD_BACKTEST_TASK = 'rain_hazard_backtest';
// Calibration = first 60 % of days, test = the rest (same proportion as the
// Stage-2 spatial model's train+validation / test).
const TEST_START_FRACTION = 0.6;
const CHUNK_DAYS = 31;
// Below this, calibration rates and test scores are too noisy to report.
const MIN_DAYS = 60;
const HAZARDS = ['flood', 'landslide'] as const;

type Hazard = (typeof HAZARDS)[number];

/**
 * Milestone 7: replays the flood and landslide rule baselines over the
 * archived hourly GSMaP_Gauge rainfall (rainfall_point_archive), one level
 * per district and local day, and scores them against BNPB DIBI reports
 * (disaster_event_labels) on a chronological calibration / test split.
 * Levels come from ai-engine (the same rules as live, vectorised); scores
 * too. One run is stored per backtest in `rainfall_model_runs`.
 *
 * Static inputs are today's: InaRISK flood index and its national terciles,
 * and DEM slope where sampled. No historical river-gauge status exists, so
 * the gauge floor of the live flood rule never applies here.
 */
@Injectable()
export class RainfallHazardBacktestService {
  private readonly logger = new Logger(RainfallHazardBacktestService.name);
  private running = false;

  constructor(
    private readonly engine: RainfallEngineClient,
    private readonly hazardIndex: DistrictHazardIndexService,
    private readonly terrain: DistrictTerrainService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(RainfallPointArchive)
    private readonly archiveRepository: Repository<RainfallPointArchive>,
    @InjectRepository(DisasterEventLabel)
    private readonly labelRepository: Repository<DisasterEventLabel>,
    @InjectRepository(RainfallModelRun)
    private readonly runRepository: Repository<RainfallModelRun>,
  ) {}

  startInBackground(trigger: 'scheduled' | 'manual'): boolean {
    if (this.running) return false;
    void this.run(trigger).catch((error: Error) =>
      this.logger.error(`Hazard backtest failed: ${error.message}`),
    );
    return true;
  }

  async run(
    trigger: 'scheduled' | 'manual',
    now: Date = new Date(),
  ): Promise<RainfallModelRun | null> {
    if (this.running) return null;
    this.running = true;
    const run = this.runRepository.create({
      task: HAZARD_BACKTEST_TASK,
      status: 'failed',
      trigger,
      issuedAt: now,
      parameters: {},
      warnings: [],
    });
    try {
      await this.execute(run, now);
    } catch (error) {
      run.status = 'failed';
      run.error = (error as Error).message;
    } finally {
      run.completedAt = new Date();
      this.running = false;
    }
    const saved = await this.runRepository.save(run);
    this.logger.log(`Hazard backtest ${saved.id}: ${saved.status}`);
    return saved;
  }

  private async execute(run: RainfallModelRun, now: Date): Promise<void> {
    const districts = await this.loadDistricts();
    const index = new Map(districts.map((d, i) => [d.id, i]));
    const coverage = await this.archiveCoverage();
    run.parameters = {
      archiveProduct: GSMAP_ARCHIVE_PRODUCT,
      labelSource: DIBI_SOURCE,
      testStartFraction: TEST_START_FRACTION,
      embargoDays: 1,
      toleranceDays: 1,
      minHoursIssuedPerDay: 20,
      localDay:
        'Civil date in the district time zone (WIB/WITA/WIT by province, Keppres 41/1987); a day takes the highest hourly level issued in it.',
      labelMapping:
        'Flood: Banjir, Banjir Bandang, Banjir Genangan, Banjir dan Tanah Longsor. Landslide: Tanah Longsor, Gerakan Tanah, Banjir dan Tanah Longsor. Banjir Rob (tidal) excluded.',
    };
    if (!coverage) {
      run.status = 'insufficient_data';
      run.error = 'No archived rainfall yet (npm run rainfall:archive).';
      return;
    }
    // The first local day needs BACKTEST_LEAD_DAYS of archive before it;
    // a local day (UTC+7..+9) ends inside the same UTC day.
    const firstDay = addDays(coverage.first, BACKTEST_LEAD_DAYS);
    const lastDay = coverage.last;
    const days =
      Math.round((lastDay.getTime() - firstDay.getTime()) / 86_400_000) + 1;
    if (days < MIN_DAYS) {
      run.status = 'insufficient_data';
      run.error = `Archive covers ${Math.max(days, 0)} evaluable days; at least ${MIN_DAYS} needed.`;
      run.dataSummary = {
        archiveFirstDay: isoDay(coverage.first),
        archiveLastDay: isoDay(lastDay),
      };
      return;
    }

    const labels = await this.labelRepository.find({
      select: { districtId: true, localDate: true, hazard: true },
      where: {
        source: DIBI_SOURCE,
        localDate: Between(isoDay(firstDay), isoDay(lastDay)),
      },
    });
    const events = Object.fromEntries(
      HAZARDS.map((h) => [
        h,
        eventMatrix(
          labels.filter((l) => l.hazard === h),
          index,
          firstDay,
          days,
        ),
      ]),
    ) as Record<Hazard, Int8Array>;
    const labelLast = await this.labelRepository
      .createQueryBuilder('l')
      .select("to_char(max(l.local_date), 'YYYY-MM-DD')", 'last')
      .where('l.source = :source', { source: DIBI_SOURCE })
      .getRawOne<{ last: string | null }>();
    if (!labels.length) {
      run.status = 'insufficient_data';
      run.error = 'No DIBI labels in the archive period (import labels first).';
      return;
    }

    const indices = await this.hazardIndex.load(BNPB_LAYER_FLOOD_HAZARD_INDEX);
    const breaks = nationalTerciles(
      [...indices.values()]
        .map((i) => i.valueMean)
        .filter((v): v is number => v !== null),
    );
    const profiles = await this.terrain.load();
    const points = districts.map((d) => ({
      id: d.id,
      utcOffsetHours: d.utcOffsetHours,
      floodHazardIndex: indices.get(d.id)?.valueMean ?? null,
      slopeSamplesDeg: profiles.get(d.id)?.slopeSamplesDeg ?? null,
    }));

    const matrices = Object.fromEntries(
      HAZARDS.flatMap((h) => [
        [`${h}Level`, new Int8Array(districts.length * days).fill(-1)],
        [`${h}Trigger`, new Int8Array(districts.length * days).fill(-1)],
      ]),
    ) as Record<string, Int8Array>;
    let modelVersions: Record<string, string> = {};
    for (const chunk of dayChunks(days, CHUNK_DAYS)) {
      const chunkFirst = addDays(firstDay, chunk.offset);
      const chunkLast = addDays(chunkFirst, chunk.days - 1);
      const utcFirst = addDays(chunkFirst, -BACKTEST_LEAD_DAYS);
      const rows = await this.archiveRepository.find({
        select: { districtId: true, day: true, hourlyMm: true },
        where: {
          product: GSMAP_ARCHIVE_PRODUCT,
          day: Between(isoDay(utcFirst), isoDay(chunkLast)),
        },
      });
      const series = rainSeries(rows, index, utcFirst, chunkLast);
      const response = await this.engine.replayRainHazardRules({
        seriesStart: series.seriesStart.toISOString(),
        hours: series.hours,
        dataB64: float32ToBase64(series.values),
        firstDay: isoDay(chunkFirst),
        days: chunk.days,
        points,
        floodParameters: { susceptibilityBreaks: breaks },
        minHoursIssuedPerDay: 20,
      });
      modelVersions = response.modelVersions;
      for (const point of response.points) {
        const p = index.get(point.id)!;
        const put = (key: string, values: number[]) =>
          values.forEach((v, d) => {
            matrices[key][p * days + chunk.offset + d] = v;
          });
        put('floodLevel', point.floodLevel);
        put('floodTrigger', point.floodTrigger);
        put('landslideLevel', point.landslideLevel);
        put('landslideTrigger', point.landslideTrigger);
      }
    }

    const testStartDay = Math.floor(days * TEST_START_FRACTION);
    const evaluation = await this.engine.evaluateRainHazardBacktest({
      issuedAt: now.toISOString(),
      firstDay: isoDay(firstDay),
      points: districts.length,
      days,
      testStartDay,
      embargoDays: 1,
      toleranceDays: 1,
      hazards: HAZARDS.map((h) => ({
        hazard: h,
        levelsB64: int8ToBase64(matrices[`${h}Level`]),
        triggersB64: int8ToBase64(matrices[`${h}Trigger`]),
        eventsB64: int8ToBase64(events[h]),
      })),
    });

    const evaluable = (key: string) =>
      matrices[key].reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
    run.status = 'completed';
    run.modelVersion = evaluation.modelVersion;
    run.parameters = {
      ...run.parameters,
      ruleVersions: modelVersions,
      floodSusceptibilityBreaks: breaks,
    };
    run.dataSummary = {
      firstDay: isoDay(firstDay),
      lastDay: isoDay(lastDay),
      days,
      testStartDay: isoDay(addDays(firstDay, testStartDay)),
      districts: districts.length,
      archiveFirstDay: isoDay(coverage.first),
      archiveMissingDistrictHours: coverage.missingHours,
      evaluableDistrictDays: {
        flood: evaluable('floodLevel'),
        landslide: evaluable('landslideLevel'),
      },
      labelsInPeriod: Object.fromEntries(
        HAZARDS.map((h) => [h, labels.filter((l) => l.hazard === h).length]),
      ),
      districtDaysWithEvents: Object.fromEntries(
        HAZARDS.map((h) => [h, events[h].reduce((n, v) => n + v, 0)]),
      ),
      labelsLastDate: labelLast?.last ?? null,
      floodIndexDistricts: [...indices.values()].filter(
        (i) => i.valueMean !== null,
      ).length,
      terrainProfiledDistricts: profiles.size,
    };
    run.results = evaluation.hazards;
    run.warnings = [
      'Rainfall is the GSMaP_Gauge standard archive (gauge-adjusted, 3-day latency); live levels use GSMaP_Gauge_NOW, which is noisier — live skill may be lower.',
      "No historical river-gauge status: the live flood rule's gauge floor never applies in this replay.",
      `DEM slope known for ${profiles.size} of ${districts.length} districts (sampling continues); elsewhere terrain is unknown and landslide levels are never lowered.`,
      "Static inputs (InaRISK index, DEM slope) are today's, applied to the whole period.",
      'Labels are reported events (DIBI): unreported events count as none, so FAR is an upper bound and POD/CSI lower bounds.',
    ];
  }

  private async loadDistricts() {
    const rows = await this.districtRepository
      .createQueryBuilder('d')
      .select('d.id', 'id')
      .addSelect('d.bps_code', 'code')
      .orderBy('d.bps_code', 'ASC')
      .getRawMany<{ id: string; code: string }>();
    return rows
      .map((r) => ({
        id: r.id,
        utcOffsetHours: utcOffsetForRegionCode(r.code),
      }))
      .filter(
        (d): d is { id: string; utcOffsetHours: number } =>
          d.utcOffsetHours !== null,
      );
  }

  private async archiveCoverage() {
    const [row] = await this.archiveRepository.query<
      Array<{
        first: string | null;
        last: string | null;
        missing: string | null;
      }>
    >(
      `SELECT to_char(min(day), 'YYYY-MM-DD') AS first,
              to_char(max(day), 'YYYY-MM-DD') AS last,
              sum(missing_hours) AS missing
       FROM rainfall_point_archive WHERE product = $1`,
      [GSMAP_ARCHIVE_PRODUCT],
    );
    const first = row?.first ? parseIsoDay(row.first) : null;
    const last = row?.last ? parseIsoDay(row.last) : null;
    if (!first || !last) return null;
    return { first, last, missingHours: Number(row.missing ?? 0) };
  }

  async latest() {
    const run = await this.runRepository.findOne({
      where: { task: HAZARD_BACKTEST_TASK },
      order: { issuedAt: 'DESC' },
    });
    if (!run) throw new NotFoundException('No hazard backtest run yet');
    return { ...run, running: this.running };
  }
}
