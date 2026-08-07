import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { Notification } from '../database/entities';
import { NotificationType, PriorityLevel } from '../common/enums/domain.enum';
import { DomainEvents } from '../common/events/domain-events';
import type {
  DecisionRecommendationCreatedEvent,
  HazardEventCreatedEvent,
  HazardRelationshipDetectedEvent,
  RiskAssessmentCompletedEvent,
} from '../common/events/domain-events';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { NOTIFICATIONS_REDIS_CHANNEL } from './notifications.constants';

const HIGH_PRIORITY_LEVELS: string[] = [
  PriorityLevel.HIGH,
  PriorityLevel.CRITICAL,
];

/**
 * Generalizes ORION's notifications.service.ts — same
 * @OnEvent -> persist -> Redis pub/sub fan-out pattern, `related_earthquake_id`
 * generalized to `related_hazard_event_id` (docs/MIGRATION_FROM_ORION.md).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(DomainEvents.HAZARD_EVENT_CREATED, { async: true })
  async handleHazardEventCreated(
    event: HazardEventCreatedEvent,
  ): Promise<void> {
    await this.createAndPublish({
      type: NotificationType.NEW_HAZARD_EVENT,
      title: `New ${event.hazardType} event detected`,
      body: `${event.affectedDistrictIds.length} district(s) potentially affected.`,
      relatedHazardEventId: event.hazardEventId,
    });
  }

  @OnEvent(DomainEvents.RISK_ASSESSMENT_COMPLETED, { async: true })
  async handleRiskAssessmentCompleted(
    event: RiskAssessmentCompletedEvent,
  ): Promise<void> {
    const threshold =
      this.config.get<number>('RISK_NOTIFICATION_THRESHOLD') ?? 60;
    if (event.riskScore < threshold) {
      return;
    }

    await this.createAndPublish({
      type: NotificationType.HIGH_RISK_ASSESSMENT,
      title: `High risk score (${event.riskScore.toFixed(1)}) — ${event.districtName}`,
      body: `${event.hazardType} risk assessment scored ${event.riskScore.toFixed(1)}/100 (${event.exposureLevel ?? 'unknown'} exposure).`,
      relatedHazardEventId: event.hazardEventId ?? undefined,
    });
  }

  @OnEvent(DomainEvents.DECISION_RECOMMENDATION_CREATED, { async: true })
  async handleDecisionRecommendationCreated(
    event: DecisionRecommendationCreatedEvent,
  ): Promise<void> {
    if (!HIGH_PRIORITY_LEVELS.includes(event.priorityLevel)) {
      return;
    }

    await this.createAndPublish({
      type: NotificationType.HIGH_RISK_ASSESSMENT,
      title: `${event.priorityLevel.toUpperCase()} priority: ${event.districtName}`,
      body: `Priority score ${event.priorityScore.toFixed(1)}/100 — review the recommendation.`,
      relatedHazardEventId: event.hazardEventId ?? undefined,
      relatedRecommendationId: event.decisionRecommendationId,
    });
  }

  @OnEvent(DomainEvents.HAZARD_RELATIONSHIP_DETECTED, { async: true })
  async handleHazardRelationshipDetected(
    event: HazardRelationshipDetectedEvent,
  ): Promise<void> {
    await this.createAndPublish({
      type: NotificationType.HAZARD_RELATIONSHIP_DETECTED,
      title: `Cascading hazard detected (${event.relationshipType})`,
      body: `Confidence ${event.confidenceScore.toFixed(2)} — review the linked hazard events.`,
      relatedHazardEventId: event.relatedEventId,
    });
  }

  private async createAndPublish(input: {
    type: NotificationType;
    title: string;
    body: string;
    relatedHazardEventId?: string;
    relatedRecommendationId?: string;
  }): Promise<void> {
    const notification = this.notificationRepository.create({
      user: null,
      type: input.type,
      title: input.title,
      body: input.body,
      relatedHazardEvent: input.relatedHazardEventId
        ? { id: input.relatedHazardEventId }
        : null,
      relatedRecommendation: input.relatedRecommendationId
        ? { id: input.relatedRecommendationId }
        : null,
    });
    const saved = await this.notificationRepository.save(notification);

    // Redis Pub/Sub fanout — lets every apps/api instance's WebSocket
    // gateway push this to its own connected clients.
    await this.redis.publish(
      NOTIFICATIONS_REDIS_CHANNEL,
      JSON.stringify(saved),
    );
    this.logger.log(`Notification published: ${input.title}`);
  }

  findForUser(userId: string | undefined, unreadOnly: boolean) {
    const qb = this.notificationRepository
      .createQueryBuilder('n')
      .orderBy('n.createdAt', 'DESC')
      .take(100);

    if (userId) {
      qb.where('(n.user_id = :userId OR n.user_id IS NULL)', { userId });
    } else {
      qb.where('n.user_id IS NULL');
    }

    if (unreadOnly) {
      qb.andWhere('n.isRead = false');
    }

    return qb.getMany();
  }

  async markRead(id: string): Promise<void> {
    await this.notificationRepository.update({ id }, { isRead: true });
  }

  async markAllRead(): Promise<void> {
    await this.notificationRepository.update(
      { isRead: false, user: IsNull() },
      { isRead: true },
    );
  }
}
