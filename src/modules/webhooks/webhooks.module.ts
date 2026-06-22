import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ApiConfigService } from '../../config/api-config.service';
import { BillingModule } from '../billing/billing.module';
import { STRIPE_EVENTS_QUEUE } from '../queues/queues.constants';
import { StripeModule } from '../stripe/stripe.module';
import { StripeEventsProcessor } from './stripe-events.processor';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    StripeModule,
    BillingModule,
    BullModule.registerQueue({ name: STRIPE_EVENTS_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, StripeEventsProcessor, ApiConfigService],
})
export class WebhooksModule {}
