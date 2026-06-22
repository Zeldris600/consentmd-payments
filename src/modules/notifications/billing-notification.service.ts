import { Injectable } from '@nestjs/common';
import type { OrganizationSubscription } from '../billing/entities/organization-subscription.entity';
import type { BillingEmailType } from '../queues/billing-lifecycle.payload';
import { EmailService } from './email.service';

@Injectable()
export class BillingNotificationService {
  constructor(private readonly emailService: EmailService) {}

  async send(
    type: BillingEmailType,
    record: OrganizationSubscription,
    options?: { portalUrl?: string; orgName?: string },
  ): Promise<void> {
    const to = record.billingEmail;
    if (!to) return;

    const orgLabel = options?.orgName ?? `organization ${record.organizationId}`;
    const portalLine = options?.portalUrl
      ? `\n\nUpdate your payment method: ${options.portalUrl}`
      : '';

    const graceEnd = record.gracePeriodEnd
      ? record.gracePeriodEnd.toISOString().slice(0, 10)
      : 'soon';

    const messages: Record<
      BillingEmailType,
      { subject: string; text: string }
    > = {
      payment_failed: {
        subject: `[ConsentMD] Payment failed for ${orgLabel}`,
        text:
          `We could not process the subscription payment for ${orgLabel}.\n\n` +
          `Your team keeps full access until ${graceEnd} (grace period). ` +
          `After that, the organization will be suspended and seat access reduced.` +
          portalLine,
      },
      grace_expiring: {
        subject: `[ConsentMD] Billing grace period ending for ${orgLabel}`,
        text:
          `The billing grace period for ${orgLabel} ends on ${graceEnd}.\n\n` +
          `Please update your payment method to avoid suspension.` +
          portalLine,
      },
      suspended: {
        subject: `[ConsentMD] Organization suspended — ${orgLabel}`,
        text:
          `${orgLabel} has been suspended due to unpaid billing.\n\n` +
          `Premium features are disabled and member seats have been reduced. ` +
          `Restore access by updating payment in the billing portal.` +
          portalLine,
      },
      payment_recovered: {
        subject: `[ConsentMD] Payment received — ${orgLabel}`,
        text:
          `Payment for ${orgLabel} was successful. Subscription access is fully restored.`,
      },
    };

    const { subject, text } = messages[type];
    await this.emailService.sendMail({ to, subject, text });
  }
}
