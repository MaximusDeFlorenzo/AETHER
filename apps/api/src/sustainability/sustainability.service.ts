import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import {
  District,
  PopulationStatistic,
  ResourceOptimizationPlan,
  RiskAssessment,
  SustainabilityMetric,
} from '../database/entities';
import { HazardType, RiskAssessmentStatus } from '../common/enums/domain.enum';
import { CacheService } from '../redis/cache.service';
import type {
  SdgIndicatorValue,
  SustainabilityMetricsResponse,
} from './sustainability-metrics.types';

const METRICS_TTL_SECONDS = 300;

// Statuses that count as "a response was actually mobilized," not just
// drafted — used by both the climate-resilience and response-efficiency
// components below.
const RESPONDED_PLAN_STATUSES = ['approved', 'executed'];

// v0 documented heuristic constants — same posture as apps/ai-engine's
// hazard_prediction/ modules (a transparent weighted formula, not a
// calibrated model, because no ground-truth outcome dataset exists yet).
// Rough order-of-magnitude placeholders, explicitly not a calibrated
// emissions model — there is no real carbon-accounting data source wired
// up yet. Revisit once one exists.
const AVOIDED_EMISSIONS_TONS_PER_CONTAINED_WILDFIRE = 50;
const MONTHLY_CARBON_TARGET_TONS_PER_DISTRICT = 100;
const RESPONSE_HOURS_PENALTY_PER_HOUR = 2;
const SDG_TARGET_SCORE = 80;

@Injectable()
export class SustainabilityService implements OnModuleInit {
  private readonly logger = new Logger(SustainabilityService.name);

  constructor(
    @InjectRepository(SustainabilityMetric)
    private readonly metricRepository: Repository<SustainabilityMetric>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(RiskAssessment)
    private readonly riskAssessmentRepository: Repository<RiskAssessment>,
    @InjectRepository(ResourceOptimizationPlan)
    private readonly planRepository: Repository<ResourceOptimizationPlan>,
    @InjectRepository(PopulationStatistic)
    private readonly populationStatisticRepository: Repository<PopulationStatistic>,
    private readonly cache: CacheService,
  ) {}

  /** Immediate run on startup so the dashboard isn't empty while waiting for
   * the first scheduled run — same convention IngestionScheduler uses. */
  onModuleInit() {
    void this.computeAndPersistMetrics();
  }

  /**
   * Recomputes the current calendar month's `sustainability_metrics` row for
   * every district from hazard-event outcomes (risk_assessments),
   * decision_recommendations, and resource_optimization_plans — the
   * aggregation job docs/API_SPEC.md §8 always described but that never
   * existed until now. Re-running mid-month intentionally overwrites the
   * current month's row (a rolling recompute), so it stays accurate as new
   * events/plans land; only the current month is ever touched.
   */
  // Double-counting guard: this loop is over `districts` (kabupaten/kota)
  // ONLY, each independent (siblings, never parent/child) — safe to sum
  // across all of them. `RiskAssessment.district` only ever FKs to
  // `District`; `subdistricts`/`villages` have no risk_assessments linked
  // at all today. If a future change adds subdistrict/village-level
  // assessments, this loop must NOT also iterate those — a district's
  // total already implicitly covers everything inside it, so adding a
  // child region's numbers on top would double-count. Aggregate at exactly
  // one level per metric, never a district and its own children together.
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async computeAndPersistMetrics(): Promise<void> {
    const districts = await this.districtRepository.find();
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );

    this.logger.log(
      `Computing sustainability metrics for ${districts.length} district(s), period ${periodStart.toISOString().slice(0, 10)}..${periodEnd.toISOString().slice(0, 10)}`,
    );

    for (const district of districts) {
      try {
        await this.computeDistrictMetrics(district, periodStart, periodEnd);
      } catch (error) {
        this.logger.warn(
          `Sustainability metrics computation failed for district=${district.id}: ${(error as Error).message}`,
        );
      }
    }

    await this.cache.invalidatePattern('*');
  }

  private async computeDistrictMetrics(
    district: District,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const assessments = await this.riskAssessmentRepository.find({
      where: {
        district: { id: district.id },
        status: RiskAssessmentStatus.COMPLETED,
      },
      relations: { hazardEvent: true, decisionRecommendation: true },
    });
    const periodAssessments = assessments.filter(
      (a) => a.assessedAt >= periodStart && a.assessedAt <= periodEnd,
    );

    const plans = await this.planRepository.find({
      where: { district: { id: district.id } },
      relations: { riskAssessment: true },
    });
    const periodPlans = plans.filter(
      (p) => p.createdAt >= periodStart && p.createdAt <= periodEnd,
    );

    const withRecommendation = periodAssessments.filter(
      (a) => a.decisionRecommendation,
    );
    const respondedPlanCount = periodPlans.filter((p) =>
      RESPONDED_PLAN_STATUSES.includes(p.status),
    ).length;

    // "Coverage": of the assessments that actually produced a decision
    // recommendation, how many got a real (approved/executed, not just
    // drafted) resource plan. No incidents needing a response this period
    // reads as trivially fully covered, not zero.
    const planCoverageComponent =
      withRecommendation.length > 0
        ? clamp((respondedPlanCount / withRecommendation.length) * 100, 0, 100)
        : 100;

    const avgRiskScore =
      periodAssessments.length > 0
        ? periodAssessments.reduce((sum, a) => sum + a.riskScore, 0) /
          periodAssessments.length
        : 0;
    const riskComponent = clamp(100 - avgRiskScore, 0, 100);
    const climateResilienceScore = round2(
      0.6 * riskComponent + 0.4 * planCoverageComponent,
    );

    const population = await this.populationStatisticRepository.findOne({
      where: { district: { id: district.id } },
      order: { year: 'DESC' },
    });
    // `estimatedAffectedPopulation` should always be set on an assessment
    // that has a decision recommendation (it's written before the
    // recommendation is created), but skip rather than zero-fill on the
    // off chance a row predates that guarantee — an unknown contribution
    // must not silently read as "this assessment protected zero people".
    const rawProtectedPopulation = withRecommendation
      .filter((a) => a.estimatedAffectedPopulation != null)
      .reduce((sum, a) => sum + a.estimatedAffectedPopulation!, 0);
    const protectedPopulation = population
      ? Math.min(rawProtectedPopulation, population.totalPopulation)
      : rawProtectedPopulation;

    const respondedWildfireCount = periodAssessments.filter(
      (a) =>
        a.hazardType === HazardType.WILDFIRE &&
        periodPlans.some(
          (p) =>
            p.riskAssessment?.id === a.id &&
            RESPONDED_PLAN_STATUSES.includes(p.status),
        ),
    ).length;
    const carbonReductionEstimateTons =
      respondedWildfireCount * AVOIDED_EMISSIONS_TONS_PER_CONTAINED_WILDFIRE;

    // Pipeline latency (event -> decision recommendation) is the only real
    // timing signal available — there's no field dispatch/arrival data
    // source yet, so this measures our own processing speed, not real-world
    // response time. Documented, not overclaimed.
    const responseHours = withRecommendation
      .map((a) => {
        const start = a.hazardEvent?.eventTime ?? a.assessedAt;
        const end = a.decisionRecommendation.createdAt;
        return (end.getTime() - start.getTime()) / (60 * 60 * 1000);
      })
      .filter((h) => Number.isFinite(h) && h >= 0);
    const avgResponseHours =
      responseHours.length > 0
        ? responseHours.reduce((sum, h) => sum + h, 0) / responseHours.length
        : 0;
    const speedComponent = clamp(
      100 - avgResponseHours * RESPONSE_HOURS_PENALTY_PER_HOUR,
      0,
      100,
    );
    const responseEfficiencyScore = round2(
      0.6 * speedComponent + 0.4 * planCoverageComponent,
    );

    const sdgIndicators = buildSdgIndicators(
      climateResilienceScore,
      carbonReductionEstimateTons,
      responseEfficiencyScore,
    );

    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const periodEndStr = periodEnd.toISOString().slice(0, 10);

    const existing = await this.metricRepository.findOne({
      where: {
        district: { id: district.id },
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
      },
    });

    await this.metricRepository.save(
      this.metricRepository.create({
        ...(existing ? { id: existing.id } : {}),
        district,
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
        sdgIndicators: sdgIndicators as unknown as Record<string, unknown>,
        climateResilienceScore,
        carbonReductionEstimate: carbonReductionEstimateTons,
        protectedPopulation,
        responseEfficiencyScore,
      }),
    );
  }

  /**
   * `GET /sustainability-metrics` (docs/API_SPEC.md §8) — a single
   * aggregate object, not a list: a specific district's latest computed
   * period if `district` is given, otherwise a national rollup averaged
   * across every district's latest computed period. Never 404s — a public
   * accountability dashboard degrades to zeroed defaults rather than
   * erroring when a district has no computed row yet (e.g. right after
   * seeding, before the first cron run).
   */
  async getMetrics(filters: {
    district?: string;
    periodStart?: string;
    periodEnd?: string;
  }): Promise<SustainabilityMetricsResponse> {
    const cacheKey = `sustainability:${filters.district ?? '-'}:${filters.periodStart ?? '-'}:${filters.periodEnd ?? '-'}`;
    return this.cache.getOrSet(cacheKey, METRICS_TTL_SECONDS, () =>
      this.computeResponse(filters),
    );
  }

  private async computeResponse(filters: {
    district?: string;
    periodStart?: string;
    periodEnd?: string;
  }): Promise<SustainabilityMetricsResponse> {
    if (filters.district) {
      const district = await this.districtRepository.findOne({
        where: { id: filters.district },
      });
      if (!district) {
        throw new NotFoundException('District not found');
      }
      const row = await this.findLatestRow(filters);
      return this.toResponse(row, {
        id: district.id,
        bpsCode: district.bpsCode,
        name: district.name,
        areaKm2: district.areaKm2,
      });
    }

    const rows = await this.findLatestRowPerDistrict(filters);
    if (rows.length === 0) {
      return this.toResponse(null, null);
    }

    const avg = (values: number[]) =>
      values.length
        ? round2(values.reduce((a, b) => a + b, 0) / values.length)
        : 0;
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

    return {
      district: null,
      periodStart: rows[0].periodStart,
      periodEnd: rows[0].periodEnd,
      climateResilienceScore: avg(
        rows.map((r) => r.climateResilienceScore ?? 0),
      ),
      carbonReductionEstimateTons: sum(
        rows.map((r) => r.carbonReductionEstimate ?? 0),
      ),
      protectedPopulation: sum(rows.map((r) => r.protectedPopulation ?? 0)),
      responseEfficiencyScore: avg(
        rows.map((r) => r.responseEfficiencyScore ?? 0),
      ),
      sdgIndicators: averageSdgIndicators(rows.map((r) => r.sdgIndicators)),
    };
  }

  private findLatestRow(filters: {
    district?: string;
    periodStart?: string;
    periodEnd?: string;
  }): Promise<SustainabilityMetric | null> {
    const qb = this.metricRepository
      .createQueryBuilder('metric')
      .leftJoinAndSelect('metric.district', 'district')
      .orderBy('metric.periodStart', 'DESC')
      .limit(1);

    if (filters.district) {
      qb.andWhere('district.id = :district', { district: filters.district });
    }
    if (filters.periodStart) {
      qb.andWhere('metric.periodStart >= :periodStart', {
        periodStart: filters.periodStart,
      });
    }
    if (filters.periodEnd) {
      qb.andWhere('metric.periodEnd <= :periodEnd', {
        periodEnd: filters.periodEnd,
      });
    }
    return qb.getOne();
  }

  /** One row per district (its most recent computed period) — reduced in
   * application code rather than `DISTINCT ON` since the whole dataset is
   * small (one row per district per month) and this avoids relying on
   * Postgres-specific column-reference behavior through a relation. */
  private async findLatestRowPerDistrict(filters: {
    periodStart?: string;
    periodEnd?: string;
  }): Promise<SustainabilityMetric[]> {
    const qb = this.metricRepository
      .createQueryBuilder('metric')
      .leftJoinAndSelect('metric.district', 'district')
      .orderBy('metric.periodStart', 'DESC');

    if (filters.periodStart) {
      qb.andWhere('metric.periodStart >= :periodStart', {
        periodStart: filters.periodStart,
      });
    }
    if (filters.periodEnd) {
      qb.andWhere('metric.periodEnd <= :periodEnd', {
        periodEnd: filters.periodEnd,
      });
    }
    const rows = await qb.getMany();

    const latestByDistrict = new Map<string, SustainabilityMetric>();
    for (const row of rows) {
      if (!latestByDistrict.has(row.district.id)) {
        latestByDistrict.set(row.district.id, row);
      }
    }
    return Array.from(latestByDistrict.values());
  }

  private toResponse(
    row: SustainabilityMetric | null,
    district: SustainabilityMetricsResponse['district'],
  ): SustainabilityMetricsResponse {
    if (!row) {
      const now = new Date();
      const periodStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const periodEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
      );
      return {
        district,
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        climateResilienceScore: 0,
        carbonReductionEstimateTons: 0,
        protectedPopulation: 0,
        responseEfficiencyScore: 0,
        sdgIndicators: buildSdgIndicators(0, 0, 0),
      };
    }
    return {
      district,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      climateResilienceScore: row.climateResilienceScore ?? 0,
      carbonReductionEstimateTons: row.carbonReductionEstimate ?? 0,
      protectedPopulation: row.protectedPopulation ?? 0,
      responseEfficiencyScore: row.responseEfficiencyScore ?? 0,
      sdgIndicators:
        (row.sdgIndicators as unknown as SdgIndicatorValue[] | undefined) ?? [],
    };
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSdgIndicators(
  climateResilienceScore: number,
  carbonReductionEstimateTons: number,
  responseEfficiencyScore: number,
): SdgIndicatorValue[] {
  return [
    {
      goal: 'SDG 11',
      label: 'Sustainable Cities and Communities',
      score: climateResilienceScore,
      target: SDG_TARGET_SCORE,
    },
    {
      goal: 'SDG 13',
      label: 'Climate Action',
      score: clamp(
        (carbonReductionEstimateTons /
          MONTHLY_CARBON_TARGET_TONS_PER_DISTRICT) *
          100,
        0,
        100,
      ),
      target: SDG_TARGET_SCORE,
    },
    {
      goal: 'SDG 3',
      label: 'Good Health and Well-Being',
      score: responseEfficiencyScore,
      target: SDG_TARGET_SCORE,
    },
  ];
}

function averageSdgIndicators(
  indicatorSets: Array<Record<string, unknown>>,
): SdgIndicatorValue[] {
  const parsed = indicatorSets
    .map((set) => set as unknown as SdgIndicatorValue[])
    .filter((set) => Array.isArray(set) && set.length > 0);
  if (parsed.length === 0) {
    return buildSdgIndicators(0, 0, 0);
  }
  const goals = parsed[0].map((indicator) => indicator.goal);
  return goals.map((goal) => {
    const matching = parsed
      .map((set) => set.find((i) => i.goal === goal))
      .filter((i): i is SdgIndicatorValue => !!i);
    const avgScore =
      matching.reduce((sum, i) => sum + i.score, 0) / matching.length;
    return {
      goal,
      label: matching[0].label,
      score: round2(avgScore),
      target: matching[0].target,
    };
  });
}
