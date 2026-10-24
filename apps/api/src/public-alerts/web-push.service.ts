import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PublicAlert, PushSubscription } from '../database/entities';
import type { ResolvedArea } from './public-area.resolver';

const SEND_BATCH_SIZE = 50;
// Push services drop undelivered messages after TTL; an alarm that arrives
// hours late is worse than useless, but a phone briefly offline (lift, bad
// signal) should still get it.
const PUSH_TTL_SECONDS = 60 * 60;

export interface PushSendResult {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * Web Push delivery for citizen alarms. Disabled (no-op, logs once) unless
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are all set — the
 * in-app red screen still works without it (the web client polls
 * /public/alerts/active), only the "arrives while the site is closed" path
 * needs push.
 */
@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private publicKey: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PushSubscription)
    private readonly subscriptionRepository: Repository<PushSubscription>,
    @InjectRepository(PublicAlert)
    private readonly alertRepository: Repository<PublicAlert>,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');
    if (!publicKey || !privateKey || !subject) {
      this.logger.warn(
        'VAPID keys not configured — citizen alarms will only show in open browser tabs, not as push notifications. Generate with `npx web-push generate-vapid-keys`.',
      );
      return;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.publicKey = publicKey;
  }

  getPublicKey(): string | null {
    return this.publicKey;
  }

  async upsertSubscription(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    area: ResolvedArea;
    userAgent: string | null;
  }): Promise<void> {
    const existing = await this.subscriptionRepository.findOne({
      where: { endpoint: input.endpoint },
    });
    const row =
      existing ??
      this.subscriptionRepository.create({ endpoint: input.endpoint });
    row.p256dh = input.p256dh;
    row.auth = input.auth;
    row.district = input.area.district;
    row.subdistrict = input.area.subdistrict;
    row.village = input.area.village;
    row.userAgent = input.userAgent?.slice(0, 255) ?? null;
    await this.subscriptionRepository.save(row);
  }

  async removeSubscription(endpoint: string): Promise<void> {
    await this.subscriptionRepository.delete({ endpoint });
  }

  /**
   * Subscribers an alert should reach. A subscriber who only picked a
   * coarser area (just the district, or district + subdistrict) is
   * INCLUDED when the alert narrows to a subdistrict/village inside it —
   * for a life-safety alarm, waking someone who turns out to live one
   * village over is the acceptable failure; silently skipping someone who
   * lives in the targeted village is not.
   */
  findRecipients(alert: PublicAlert): Promise<PushSubscription[]> {
    const qb = this.subscriptionRepository
      .createQueryBuilder('sub')
      .where('sub.district_id = :district', { district: alert.district.id });
    if (alert.subdistrict) {
      qb.andWhere(
        '(sub.subdistrict_id IS NULL OR sub.subdistrict_id = :subdistrict)',
        {
          subdistrict: alert.subdistrict.id,
        },
      );
    }
    if (alert.village) {
      qb.andWhere('(sub.village_id IS NULL OR sub.village_id = :village)', {
        village: alert.village.id,
      });
    }
    return qb.getMany();
  }

  async sendAlert(alert: PublicAlert): Promise<PushSendResult> {
    const result: PushSendResult = { sent: 0, failed: 0, removed: 0 };
    if (!this.publicKey) return result;

    const recipients = await this.findRecipients(alert);
    const payload = JSON.stringify({
      alertId: alert.id,
      hazard: alert.hazard,
      title: alert.title.toUpperCase(),
      body: alert.destinationName
        ? `${alert.action}. Tujuan: ${alert.destinationName}.`
        : `${alert.action}.`,
      url: `/peringatan/${alert.id}`,
    });

    const delivered: string[] = [];
    const gone: string[] = [];
    for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
      const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
      const outcomes = await Promise.allSettled(
        batch.map((sub) =>
          webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            {
              TTL: PUSH_TTL_SECONDS,
              urgency: 'high',
              topic: `alert-${alert.id.slice(0, 8)}`,
            },
          ),
        ),
      );
      outcomes.forEach((outcome, index) => {
        const sub = batch[index];
        if (outcome.status === 'fulfilled') {
          result.sent += 1;
          delivered.push(sub.id);
          return;
        }
        result.failed += 1;
        const statusCode = (outcome.reason as { statusCode?: number })
          .statusCode;
        // 404/410 = the browser unsubscribed or the endpoint expired; it
        // will never succeed again, so stop paying for it on every alarm.
        if (statusCode === 404 || statusCode === 410) {
          gone.push(sub.id);
        } else {
          this.logger.warn(
            `Push to subscription ${sub.id} failed (${statusCode ?? 'no status'}): ${(outcome.reason as Error).message}`,
          );
        }
      });
    }

    if (delivered.length > 0) {
      await this.subscriptionRepository.update(
        { id: In(delivered) },
        { lastSuccessAt: new Date() },
      );
    }
    if (gone.length > 0) {
      await this.subscriptionRepository.delete({ id: In(gone) });
      result.removed = gone.length;
    }
    await this.alertRepository.update(
      { id: alert.id },
      { pushSentCount: result.sent, pushFailedCount: result.failed },
    );
    this.logger.log(
      `Alert ${alert.id}: push sent=${result.sent} failed=${result.failed} removed=${result.removed}`,
    );
    return result;
  }
}
