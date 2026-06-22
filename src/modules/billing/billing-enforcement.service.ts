import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bull';
import { Repository } from 'typeorm';
import { ApiConfigService } from '../../config/api-config.service';
import { IdpService } from '../idp/idp.service';
import { BillingNotificationService } from '../notifications/billing-notification.service';
import {
  BILLING_GRACE_EXPIRY_JOB,
  BILLING_LIFECYCLE_QUEUE,
  BILLING_SEND_EMAIL_JOB,
} from '../queues/queues.constants';
import type {
  BillingEmailJobPayload,
  GraceExpiryJobPayload,
} from '../queues/billing-lifecycle.payload';
import { StripeService } from '../stripe/stripe.service';
import { PlanService } from './plan.service';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { SubscriptionStatus } from './enums/plan-tier.enum';

@Injectable()
export class BillingEnforcementService {
  private readonly logger = new Logger(BillingEnforcementService.name);

  constructor(
    @InjectRepository(OrganizationSubscription)
    private readonly subscriptionRepo: Repository<OrganizationSubscription>,
    @InjectQueue(BILLING_LIFECYCLE_QUEUE)
    private readonly lifecycleQueue: Queue,
    private readonly idpService: IdpService,
    private readonly billingNotificationService: BillingNotificationService,
    private readonly stripeService: StripeService,
    private readonly planService: PlanService,
    private readonly apiConfig: ApiConfigService,
  ) {}

  isWithinGracePeriod(record: OrganizationSubscription): boolean {
    if (record.status !== SubscriptionStatus.PAST_DUE || !record.gracePeriodEnd) {
      return false;
    }
    return new Date() < record.gracePeriodEnd;
  }

  isSuspended(record: OrganizationSubscription): boolean {
    return (
      record.status === SubscriptionStatus.SUSPENDED || !!record.suspendedAt
    );
  }

  async onPaymentFailed(organizationId: string): Promise<void> {
    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });
    if (!record) return;

    const now = new Date();
    if (!record.gracePeriodEnd) {
      const graceDays = this.apiConfig.billingGracePeriodDays;
      record.pastDueSince = now;
      record.gracePeriodEnd = new Date(
        now.getTime() + graceDays * 24 * 60 * 60 * 1000,
      );
    }

    record.status = SubscriptionStatus.PAST_DUE;
    record.suspendedAt = null;
    await this.subscriptionRepo.save(record);

    await this.idpService.updateOrganizationBillingStatus(organizationId, {
      billing_status: 'grace',
      reason: 'invoice_payment_failed',
    });

    await this.scheduleGraceExpiry(organizationId, record.gracePeriodEnd!);
    await this.scheduleGraceReminder(organizationId, record.gracePeriodEnd!);
    await this.enqueueEmail(organizationId, 'payment_failed');
  }

  async onPaymentRecovered(organizationId: string): Promise<void> {
    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });
    if (!record) return;

    const wasSuspended = this.isSuspended(record);
    const planSeatLimit = this.planService.seatLimitForPlan(record.plan);

    record.status = SubscriptionStatus.ACTIVE;
    record.pastDueSince = null;
    record.gracePeriodEnd = null;
    record.suspendedAt = null;
    if (record.seatLimit < planSeatLimit) {
      record.seatLimit = planSeatLimit;
    }
    await this.subscriptionRepo.save(record);

    await this.cancelScheduledJobs(organizationId);

    await this.idpService.updateOrganizationBillingStatus(organizationId, {
      billing_status: 'active',
      maximum_member_count: planSeatLimit,
      reason: 'invoice_paid',
    });

    if (wasSuspended) {
      await this.enqueueEmail(organizationId, 'payment_recovered');
    }
  }

  async onSubscriptionPastDue(organizationId: string): Promise<void> {
    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });
    if (!record || record.gracePeriodEnd) return;

    await this.onPaymentFailed(organizationId);
  }

  async enforceGraceExpiry(organizationId: string): Promise<void> {
    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });
    if (!record) return;

    if (this.isSuspended(record)) return;

    const stillPastDue =
      record.status === SubscriptionStatus.PAST_DUE ||
      record.status === SubscriptionStatus.UNPAID;

    if (!stillPastDue) return;

    if (record.gracePeriodEnd && new Date() < record.gracePeriodEnd) {
      await this.scheduleGraceExpiry(organizationId, record.gracePeriodEnd);
      return;
    }

    const suspendedSeatLimit = this.apiConfig.billingSuspendedSeatLimit;
    const now = new Date();

    record.status = SubscriptionStatus.SUSPENDED;
    record.suspendedAt = now;
    record.seatLimit = suspendedSeatLimit;
    await this.subscriptionRepo.save(record);

    await this.idpService.updateOrganizationBillingStatus(organizationId, {
      billing_status: 'suspended',
      maximum_member_count: suspendedSeatLimit,
      reason: 'grace_period_expired',
    });

    await this.enqueueEmail(organizationId, 'suspended');

    this.logger.warn(
      `Suspended org ${organizationId} after grace period — seat limit ${suspendedSeatLimit}`,
    );
  }

  async sendBillingEmail(
    organizationId: string,
    type: BillingEmailJobPayload['type'],
  ): Promise<void> {
    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });
    if (!record?.billingEmail) return;

    let portalUrl: string | undefined;
    if (record.stripeCustomerId && type !== 'payment_recovered') {
      try {
        const session = await this.stripeService.createBillingPortalSession({
          customerId: record.stripeCustomerId,
          returnUrl: `${this.apiConfig.billingAppUrl}/billing`,
        });
        portalUrl = session.url ?? undefined;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Could not create billing portal URL for org ${organizationId}: ${message}`,
        );
      }
    }

    await this.billingNotificationService.send(type, record, { portalUrl });
  }

  private graceExpiryJobId(organizationId: string): string {
    return `grace-expiry:${organizationId}`;
  }

  private graceReminderJobId(organizationId: string): string {
    return `grace-reminder:${organizationId}`;
  }

  private async scheduleGraceExpiry(
    organizationId: string,
    gracePeriodEnd: Date,
  ): Promise<void> {
    const delay = Math.max(gracePeriodEnd.getTime() - Date.now(), 0);
    const jobId = this.graceExpiryJobId(organizationId);

    const existing = await this.lifecycleQueue.getJob(jobId);
    await existing?.remove();

    await this.lifecycleQueue.add(
      BILLING_GRACE_EXPIRY_JOB,
      { organizationId } satisfies GraceExpiryJobPayload,
      {
        jobId,
        delay,
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );
  }

  /** Remind 24h before grace ends. */
  private async scheduleGraceReminder(
    organizationId: string,
    gracePeriodEnd: Date,
  ): Promise<void> {
    const remindAt = gracePeriodEnd.getTime() - 24 * 60 * 60 * 1000;
    const delay = remindAt - Date.now();
    if (delay <= 0) return;

    const jobId = this.graceReminderJobId(organizationId);
    const existing = await this.lifecycleQueue.getJob(jobId);
    await existing?.remove();

    await this.lifecycleQueue.add(
      BILLING_SEND_EMAIL_JOB,
      {
        organizationId,
        type: 'grace_expiring',
      } satisfies BillingEmailJobPayload,
      {
        jobId,
        delay,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
      },
    );
  }

  private async cancelScheduledJobs(organizationId: string): Promise<void> {
    for (const jobId of [
      this.graceExpiryJobId(organizationId),
      this.graceReminderJobId(organizationId),
    ]) {
      const job = await this.lifecycleQueue.getJob(jobId);
      await job?.remove();
    }
  }

  private async enqueueEmail(
    organizationId: string,
    type: BillingEmailJobPayload['type'],
  ): Promise<void> {
    await this.lifecycleQueue.add(
      BILLING_SEND_EMAIL_JOB,
      { organizationId, type } satisfies BillingEmailJobPayload,
      {
        jobId: `billing-email:${organizationId}:${type}:${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
      },
    );
  }
}
