import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiConfigService } from '../../config/api-config.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BILLING_LIFECYCLE_QUEUE } from '../queues/queues.constants';
import { StripeModule } from '../stripe/stripe.module';
import { BillingController } from './billing.controller';
import { BillingEnforcementService } from './billing-enforcement.service';
import { BillingLifecycleProcessor } from './billing-lifecycle.processor';
import { BillingService } from './billing.service';
import { PlanService } from './plan.service';
import { OrganizationSubscription } from './entities/organization-subscription.entity';

@Module({
  imports: [
    AuthModule,
    StripeModule,
    NotificationsModule,
    TypeOrmModule.forFeature([OrganizationSubscription]),
    BullModule.registerQueue({ name: BILLING_LIFECYCLE_QUEUE }),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingEnforcementService,
    BillingLifecycleProcessor,
    PlanService,
    ApiConfigService,
  ],
  exports: [BillingService, BillingEnforcementService],
})
export class BillingModule {}
