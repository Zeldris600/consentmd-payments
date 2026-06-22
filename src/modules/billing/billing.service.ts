import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import type { CurrentUserData } from '../auth/current-user.decorator';
import { IdpService } from '../idp/idp.service';
import { StripeService } from '../stripe/stripe.service';
import { PlanTier, SubscriptionStatus } from './enums/plan-tier.enum';
import { BillingEnforcementService } from './billing-enforcement.service';
import { PlanService } from './plan.service';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CreatePortalDto } from './dto/create-portal.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';

export interface EntitlementResponse {
  active: boolean;
  plan: PlanTier | null;
  seatLimit: number;
  seatCount: number;
  status: SubscriptionStatus | 'none';
  currentPeriodEnd: Date | null;
  /** End of billing grace period while `past_due` (null if not in grace). */
  gracePeriodEnd: Date | null;
  /** True when org was suspended after grace expired. */
  suspended: boolean;
}

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(OrganizationSubscription)
    private readonly subscriptionRepo: Repository<OrganizationSubscription>,
    private readonly planService: PlanService,
    private readonly stripeService: StripeService,
    private readonly idpService: IdpService,
    private readonly billingEnforcementService: BillingEnforcementService,
  ) {}

  listPlans() {
    return this.planService.listPlans();
  }

  async getSubscription(organizationRef: string) {
    const { organizationId } =
      await this.idpService.resolveOrganizationReference(organizationRef);

    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });

    if (!record) {
      return {
        organizationId,
        subscription: null,
        entitlement: this.buildEntitlement(null, 0),
      };
    }

    return {
      organizationId,
      subscription: record,
      entitlement: this.buildEntitlement(record, record.seatCount),
    };
  }

  async getEntitlement(
    organizationRef: string,
    bearerToken?: string,
  ): Promise<EntitlementResponse> {
    const { organizationId } =
      await this.idpService.resolveOrganizationReference(organizationRef);

    let seatCount = 0;
    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });

    if (bearerToken) {
      try {
        seatCount = await this.idpService.getOrganizationMemberCount(
          bearerToken,
          organizationRef,
        );
      } catch {
        seatCount = record?.seatCount ?? 0;
      }
    } else {
      seatCount = record?.seatCount ?? 0;
    }

    return this.buildEntitlement(record, seatCount);
  }

  async createCheckout(
    user: CurrentUserData,
    bearerToken: string,
    dto: CreateCheckoutDto,
  ) {
    const { organizationId, organization: org } =
      await this.idpService.resolveOrganizationReference(dto.organizationId);

    const seatCount = await this.idpService.getOrganizationMemberCount(
      bearerToken,
      dto.organizationId,
    );

    this.planService.assertPlanMatchesSeats(dto.plan, seatCount);

    const existing = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });

    if (existing?.stripeSubscriptionId) {
      throw new UnprocessableEntityException(
        'Organization already has an active Stripe subscription. Use POST /billing/upgrade to change plans.',
      );
    }

    const billingEmail = org.billing_email ?? user.email;
    const customerId = await this.ensureStripeCustomer({
      record: existing,
      organizationId,
      tenant: user.tenant ?? org.tenant_id,
      billingEmail,
      orgName: org.name,
      existingStripeCustomerId: org.stripe_customer_id ?? undefined,
    });

    let record = existing;
    if (!record) {
      record = this.subscriptionRepo.create({
        organizationId,
        tenant: user.tenant ?? org.tenant_id,
        stripeCustomerId: customerId,
        plan: dto.plan,
        status: SubscriptionStatus.INCOMPLETE,
        seatCount,
        seatLimit: this.planService.seatLimitForPlan(dto.plan),
        billingEmail,
      });
    } else {
      record.plan = dto.plan;
      record.seatCount = seatCount;
      record.seatLimit = this.planService.seatLimitForPlan(dto.plan);
      record.billingEmail = billingEmail;
      record.tenant = user.tenant ?? org.tenant_id ?? record.tenant;
    }
    await this.subscriptionRepo.save(record);

    const priceId = await this.stripeService.resolvePriceId(dto.plan);
    const session = await this.stripeService.createCheckoutSession({
      customerId,
      priceId,
      organizationId,
      plan: dto.plan,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });

    if (!session.url) {
      throw new UnprocessableEntityException(
        'Stripe did not return checkout URL',
      );
    }

    return { checkoutUrl: session.url, sessionId: session.id };
  }

  async upgradeSubscription(bearerToken: string, dto: UpgradeSubscriptionDto) {
    const { organizationId } = await this.idpService.resolveOrganizationReference(
      dto.organizationId,
    );

    const seatCount = await this.idpService.getOrganizationMemberCount(
      bearerToken,
      dto.organizationId,
    );

    this.planService.assertPlanMatchesSeats(dto.plan, seatCount);

    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });

    if (!record?.stripeSubscriptionId) {
      throw new NotFoundException(
        'No active Stripe subscription found. Use checkout to subscribe first.',
      );
    }

    const priceId = await this.stripeService.resolvePriceId(dto.plan);
    const updated = await this.stripeService.updateSubscriptionPlan({
      subscriptionId: record.stripeSubscriptionId,
      priceId,
      plan: dto.plan,
      organizationId,
    });

    record.plan = dto.plan;
    record.seatCount = seatCount;
    record.seatLimit = this.planService.seatLimitForPlan(dto.plan);
    record.status = this.mapStripeStatus(updated.status);
    const periodEnd = this.getSubscriptionPeriodEnd(updated);
    if (periodEnd) {
      record.currentPeriodEnd = periodEnd;
    }
    await this.subscriptionRepo.save(record);

    return {
      organizationId,
      plan: dto.plan,
      status: record.status,
      stripeSubscriptionId: record.stripeSubscriptionId,
    };
  }

  async createPortal(dto: CreatePortalDto) {
    const { organizationId } = await this.idpService.resolveOrganizationReference(
      dto.organizationId,
    );

    const record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });

    if (!record?.stripeCustomerId) {
      throw new NotFoundException(
        'No Stripe customer found for this organization',
      );
    }

    const session = await this.stripeService.createBillingPortalSession({
      customerId: record.stripeCustomerId,
      returnUrl: dto.returnUrl,
    });

    return { url: session.url };
  }

  async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const organizationId = session.metadata?.organizationId;
    if (!organizationId) return;

    const plan = session.metadata?.plan as PlanTier | undefined;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    let currentPeriodEnd: Date | undefined;
    if (subscriptionId) {
      const subscription =
        await this.stripeService.client.subscriptions.retrieve(subscriptionId);
      currentPeriodEnd = this.getSubscriptionPeriodEnd(subscription);
    }

    await this.upsertByOrganizationId(organizationId, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      ...(plan
        ? { plan, seatLimit: this.planService.seatLimitForPlan(plan) }
        : {}),
      status: SubscriptionStatus.ACTIVE,
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
    });
  }

  /** DEV recovery: activate subscription from a paid Checkout session when webhooks were missed. */
  async syncCheckoutSession(sessionId: string) {
    const session =
      await this.stripeService.client.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      throw new BadRequestException(
        `Checkout session ${sessionId} is not paid (status: ${session.payment_status})`,
      );
    }

    if (!session.metadata?.organizationId) {
      throw new BadRequestException(
        'Checkout session is missing organizationId metadata',
      );
    }

    await this.handleCheckoutCompleted(session);

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (subscriptionId) {
      const subscription =
        await this.stripeService.client.subscriptions.retrieve(subscriptionId);
      await this.handleSubscriptionUpdated(subscription);
    }

    return this.getSubscription(session.metadata.organizationId);
  }

  async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const organizationId = subscription.metadata?.organizationId;
    if (!organizationId) return;

    const existing = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });
    const wasDelinquent =
      existing?.status === SubscriptionStatus.PAST_DUE ||
      existing?.status === SubscriptionStatus.UNPAID ||
      existing?.status === SubscriptionStatus.SUSPENDED;

    const plan = subscription.metadata?.plan as PlanTier | undefined;
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;
    const periodEnd = this.getSubscriptionPeriodEnd(subscription);
    const newStatus = this.mapStripeStatus(subscription.status);
    const locallySuspended =
      !!existing && this.billingEnforcementService.isSuspended(existing);

    await this.upsertByOrganizationId(organizationId, {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      status: newStatus,
      ...(plan
        ? {
            plan,
            ...(locallySuspended
              ? {}
              : { seatLimit: this.planService.seatLimitForPlan(plan) }),
          }
        : {}),
      ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
    });

    if (newStatus === SubscriptionStatus.ACTIVE && wasDelinquent) {
      await this.billingEnforcementService.onPaymentRecovered(organizationId);
    } else if (
      newStatus === SubscriptionStatus.PAST_DUE ||
      newStatus === SubscriptionStatus.UNPAID
    ) {
      await this.billingEnforcementService.onSubscriptionPastDue(
        organizationId,
      );
    }
  }

  async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const organizationId = subscription.metadata?.organizationId;
    if (!organizationId) return;

    await this.subscriptionRepo.update(
      { organizationId },
      {
        status: SubscriptionStatus.CANCELED,
        stripeSubscriptionId: subscription.id,
      },
    );
  }

  async handleInvoicePaid(invoice: Stripe.Invoice) {
    const organizationId = await this.organizationIdFromInvoice(invoice);
    if (!organizationId) return;

    await this.billingEnforcementService.onPaymentRecovered(organizationId);
  }

  async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const organizationId = await this.organizationIdFromInvoice(invoice);
    if (!organizationId) return;

    await this.billingEnforcementService.onPaymentFailed(organizationId);
  }

  private async organizationIdFromInvoice(
    invoice: Stripe.Invoice,
  ): Promise<string | undefined> {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

    if (!customerId) return undefined;

    const record = await this.subscriptionRepo.findOne({
      where: { stripeCustomerId: customerId },
    });

    return record?.organizationId;
  }

  private async upsertByOrganizationId(
    organizationId: string,
    patch: Partial<OrganizationSubscription>,
  ) {
    let record = await this.subscriptionRepo.findOne({
      where: { organizationId },
    });

    if (!record) {
      if (!patch.stripeCustomerId || !patch.plan) {
        return;
      }
      record = this.subscriptionRepo.create({
        organizationId,
        stripeCustomerId: patch.stripeCustomerId,
        plan: patch.plan,
        status: patch.status ?? SubscriptionStatus.INCOMPLETE,
        seatCount: patch.seatCount ?? 0,
        seatLimit:
          patch.seatLimit ?? this.planService.seatLimitForPlan(patch.plan),
        ...patch,
      });
    } else {
      Object.assign(record, patch);
    }

    await this.subscriptionRepo.save(record);
  }

  private async ensureStripeCustomer(params: {
    record: OrganizationSubscription | null;
    organizationId: string;
    tenant?: string;
    billingEmail: string;
    orgName?: string;
    existingStripeCustomerId?: string;
  }): Promise<string> {
    if (params.record?.stripeCustomerId) {
      return params.record.stripeCustomerId;
    }

    if (params.existingStripeCustomerId) {
      return params.existingStripeCustomerId;
    }

    const customer = await this.stripeService.createCustomer({
      email: params.billingEmail,
      organizationId: params.organizationId,
      tenant: params.tenant,
      name: params.orgName,
    });

    return customer.id;
  }

  private buildEntitlement(
    record: OrganizationSubscription | null,
    seatCount: number,
  ): EntitlementResponse {
    if (!record) {
      return {
        active: false,
        plan: null,
        seatLimit: 0,
        seatCount,
        status: 'none',
        currentPeriodEnd: null,
        gracePeriodEnd: null,
        suspended: false,
      };
    }

    const suspended = this.billingEnforcementService.isSuspended(record);
    const inGrace = this.billingEnforcementService.isWithinGracePeriod(record);
    const activeStatuses: SubscriptionStatus[] = [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.TRIALING,
    ];

    const active =
      !suspended &&
      (activeStatuses.includes(record.status) ||
        (record.status === SubscriptionStatus.PAST_DUE && inGrace));

    return {
      active,
      plan: record.plan,
      seatLimit: record.seatLimit,
      seatCount,
      status: record.status,
      currentPeriodEnd: record.currentPeriodEnd ?? null,
      gracePeriodEnd: record.gracePeriodEnd ?? null,
      suspended,
    };
  }

  private getSubscriptionPeriodEnd(
    subscription: Stripe.Subscription,
  ): Date | undefined {
    const end = subscription.items.data[0]?.current_period_end;
    return end ? new Date(end * 1000) : undefined;
  }

  private mapStripeStatus(
    status: Stripe.Subscription.Status,
  ): SubscriptionStatus {
    switch (status) {
      case 'active':
        return SubscriptionStatus.ACTIVE;
      case 'trialing':
        return SubscriptionStatus.TRIALING;
      case 'past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
        return SubscriptionStatus.CANCELED;
      case 'unpaid':
        return SubscriptionStatus.UNPAID;
      default:
        return SubscriptionStatus.INCOMPLETE;
    }
  }
}
