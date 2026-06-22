import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bull';
import Stripe from 'stripe';
import { BillingService } from '../billing/billing.service';
import {
  PROCESS_STRIPE_EVENT_JOB,
  STRIPE_EVENTS_QUEUE,
} from '../queues/queues.constants';
import type { StripeEventJobPayload } from '../queues/stripe-event-job.payload';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectQueue(STRIPE_EVENTS_QUEUE)
    private readonly stripeEventsQueue: Queue<StripeEventJobPayload>,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Acknowledge Stripe quickly; durable processing happens on the queue worker.
   */
  async enqueueStripeEvent(event: Stripe.Event): Promise<void> {
    await this.stripeEventsQueue.add(
      PROCESS_STRIPE_EVENT_JOB,
      { event },
      {
        jobId: event.id,
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
      },
    );
    this.logger.log(`Enqueued Stripe event ${event.id} (${event.type})`);
  }

  async processStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.billingService.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.billingService.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'customer.subscription.deleted':
        await this.billingService.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'invoice.paid':
        await this.billingService.handleInvoicePaid(
          event.data.object as Stripe.Invoice,
        );
        break;
      case 'invoice.payment_failed':
        await this.billingService.handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;
      default:
        this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
    }
  }
}
