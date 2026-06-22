import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import {
  BILLING_GRACE_EXPIRY_JOB,
  BILLING_LIFECYCLE_QUEUE,
  BILLING_SEND_EMAIL_JOB,
} from '../queues/queues.constants';
import type {
  BillingEmailJobPayload,
  GraceExpiryJobPayload,
} from '../queues/billing-lifecycle.payload';
import { BillingEnforcementService } from './billing-enforcement.service';

@Processor(BILLING_LIFECYCLE_QUEUE)
export class BillingLifecycleProcessor {
  private readonly logger = new Logger(BillingLifecycleProcessor.name);

  constructor(
    private readonly billingEnforcementService: BillingEnforcementService,
  ) {}

  @Process(BILLING_GRACE_EXPIRY_JOB)
  async handleGraceExpiry(job: Job<GraceExpiryJobPayload>): Promise<void> {
    this.logger.log(
      `Enforcing grace expiry for org ${job.data.organizationId} [attempt ${job.attemptsMade + 1}]`,
    );
    await this.billingEnforcementService.enforceGraceExpiry(
      job.data.organizationId,
    );
  }

  @Process(BILLING_SEND_EMAIL_JOB)
  async handleBillingEmail(job: Job<BillingEmailJobPayload>): Promise<void> {
    this.logger.log(
      `Sending billing email ${job.data.type} for org ${job.data.organizationId}`,
    );
    await this.billingEnforcementService.sendBillingEmail(
      job.data.organizationId,
      job.data.type,
    );
  }
}
