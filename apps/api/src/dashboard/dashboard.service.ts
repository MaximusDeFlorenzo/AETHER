import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import {
  DecisionRecommendation,
  HazardEvent,
  HistoricalDisaster,
  Notification,
} from '../database/entities';
import { DomainEvents } from '../common/events/domain-events';
import { CacheService } from '../redis/cache.service';

const ACTIVE_WINDOW_HOURS = 24;
const SUMMARY_CACHE_KEY = 'dashboard:summary';
// Short TTL as a safety net between invalidations (e.g. a manually-marked
// notification as read isn't its own domain event) — invalidation on
// hazard-event/decision-recommendation creation is what keeps this feeling
// real-time.
const SUMMARY_TTL_SECONDS = 15;
const ANALYTICS_TTL_SECONDS = 60;

// Generalizes ORION's dashboard.service.ts aggregation pattern across every
// hazard type instead of earthquakes only.
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectRepository(DecisionRecommendation)
    private readonly decisionRecommendationRepository: Repository<DecisionRecommendation>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(HistoricalDisaster)
    private readonly historicalRepository: Repository<HistoricalDisaster>,
    private readonly cache: CacheService,
  ) {}

  @OnEvent(DomainEvents.HAZARD_EVENT_CREATED, { async: true })
  async onHazardEventCreated(): Promise<void> {
    await this.cache.invalidate(SUMMARY_CACHE_KEY);
    await this.cache.invalidatePattern('dashboard:analytics:*');
  }

  @OnEvent(DomainEvents.DECISION_RECOMMENDATION_CREATED, { async: true })
  async onDecisionRecommendationCreated(): Promise<void> {
    await this.cache.invalidate(SUMMARY_CACHE_KEY);
  }

  async getSummary() {
    return this.cache.getOrSet(SUMMARY_CACHE_KEY, SUMMARY_TTL_SECONDS, () =>
      this.computeSummary(),
    );
  }

  private async computeSummary() {
    const since = new Date(Date.now() - ACTIVE_WINDOW_HOURS * 60 * 60 * 1000);

    const [
      activeHazardEventCount,
      recentHazardEvents,
      highestPriorityRecommendation,
      unreadNotificationCount,
    ] = await Promise.all([
      this.hazardEventRepository
        .createQueryBuilder('event')
        .where('event.eventTime >= :since', { since })
        .getCount(),
      this.hazardEventRepository.find({
        order: { eventTime: 'DESC' },
        take: 5,
      }),
      this.decisionRecommendationRepository
        .createQueryBuilder('rec')
        .leftJoinAndSelect('rec.riskAssessment', 'riskAssessment')
        .leftJoinAndSelect('riskAssessment.district', 'district')
        .leftJoinAndSelect('riskAssessment.hazardEvent', 'hazardEvent')
        .orderBy('rec.priorityScore', 'DESC')
        .getOne(),
      this.notificationRepository.count({ where: { isRead: false } }),
    ]);

    return {
      activeHazardEventCount,
      recentHazardEvents,
      highestPriorityRecommendation,
      unreadNotificationCount,
    };
  }

  async getAnalytics(filters: {
    from?: string;
    to?: string;
    province?: string;
  }) {
    const cacheKey = `dashboard:analytics:${filters.from ?? '-'}:${filters.to ?? '-'}:${filters.province ?? '-'}`;
    return this.cache.getOrSet(cacheKey, ANALYTICS_TTL_SECONDS, () =>
      this.computeAnalytics(filters),
    );
  }

  private async computeAnalytics(filters: {
    from?: string;
    to?: string;
    province?: string;
  }) {
    const hazardEventQb = this.hazardEventRepository
      .createQueryBuilder('event')
      .select("date_trunc('day', event.eventTime)", 'day')
      .addSelect('event.hazardType', 'hazardType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('day')
      .addGroupBy('event.hazardType')
      .orderBy('day', 'ASC');

    if (filters.from)
      hazardEventQb.andWhere('event.eventTime >= :from', {
        from: filters.from,
      });
    if (filters.to)
      hazardEventQb.andWhere('event.eventTime <= :to', { to: filters.to });

    const hazardEventCountsByDay = await hazardEventQb.getRawMany<{
      day: Date;
      hazardType: string;
      count: string;
    }>();

    const hazardTypeDistribution = await this.hazardEventRepository
      .createQueryBuilder('event')
      .select('event.hazardType', 'hazardType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('event.hazardType')
      .getRawMany<{ hazardType: string; count: string }>();

    const historicalQb = this.historicalRepository
      .createQueryBuilder('h')
      .select("date_trunc('year', h.eventDate)", 'year')
      .addSelect('SUM(h.casualtiesDead)', 'totalDeaths')
      .addSelect('SUM(h.damagedBuildingsCount)', 'totalDamagedBuildings')
      .groupBy('year')
      .orderBy('year', 'ASC');

    if (filters.province) {
      historicalQb.andWhere('h.province = :province', {
        province: filters.province,
      });
    }

    const historicalCasualtiesByYear = await historicalQb.getRawMany<{
      year: Date;
      totalDeaths: string;
      totalDamagedBuildings: string;
    }>();

    return {
      hazardEventCountsByDay: hazardEventCountsByDay.map((row) => ({
        date: row.day,
        hazardType: row.hazardType,
        count: Number.parseInt(row.count, 10),
      })),
      hazardTypeDistribution: hazardTypeDistribution.map((row) => ({
        hazardType: row.hazardType,
        count: Number.parseInt(row.count, 10),
      })),
      historicalCasualtiesByYear: historicalCasualtiesByYear.map((row) => ({
        year: row.year,
        totalDeaths: Number.parseInt(row.totalDeaths, 10),
        totalDamagedBuildings: Number.parseInt(row.totalDamagedBuildings, 10),
      })),
    };
  }
}
