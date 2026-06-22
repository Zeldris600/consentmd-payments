import { Module } from '@nestjs/common';
import { ApiConfigService } from '../../config/api-config.service';
import { BillingNotificationService } from './billing-notification.service';
import { EmailService } from './email.service';

@Module({
  providers: [ApiConfigService, EmailService, BillingNotificationService],
  exports: [EmailService, BillingNotificationService],
})
export class NotificationsModule {}
