import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import {
  PROCESS_STRIPE_EVENT_JOB,
  STRIPE_EVENTS_QUEUE,
} from '../queues/queues.constants';
import type { StripeEventJobPayload } from '../queues/stripe-event-job.payload';
import { WebhooksService } from './webhooks.service';

@Processor(STRIPE_EVENTS_QUEUE)
export class StripeEventsProcessor {
  private readonly logger = new Logger(StripeEventsProcessor.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Process(PROCESS_STRIPE_EVENT_JOB)
  async handleStripeEvent(job: Job<StripeEventJobPayload>): Promise<void> {
    const event = job.data.event;
    this.logger.log(
      `Processing Stripe event ${event.id} (${event.type}) [attempt ${job.attemptsMade + 1}]`,
    );
    await this.webhooksService.processStripeEvent(event);
  }
}
