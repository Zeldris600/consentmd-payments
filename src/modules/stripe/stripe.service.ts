import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { ApiConfigService } from '../../config/api-config.service';
import { PlanTier } from '../billing/enums/plan-tier.enum';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;

  constructor(private readonly apiConfig: ApiConfigService) {
    this.stripe = new Stripe(apiConfig.stripeSecretKey);
  }

  get client(): Stripe {
    return this.stripe;
  }

  priceIdForPlan(plan: PlanTier): string {
    const priceId = (() => {
      switch (plan) {
        case PlanTier.STARTER:
          return this.apiConfig.stripePriceStarter;
        case PlanTier.PRO:
          return this.apiConfig.stripePricePro;
        case PlanTier.ENTERPRISE:
          return this.apiConfig.stripePriceEnterprise;
        default:
          throw new Error(`Unknown plan: ${plan}`);
      }
    })();

    if (!priceId) {
      throw new Error(
        `No Stripe price configured for plan "${plan}". Set STRIPE_PRICE_${plan.toUpperCase()} in .env or run scripts/provision-stripe-test-catalog.ts`,
      );
    }

    return priceId;
  }

  async resolvePriceId(plan: PlanTier): Promise<string> {
    const lookupKey = this.lookupKeyForPlan(plan);
    const prices = await this.stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    });

    if (prices.data[0]?.id) {
      return prices.data[0].id;
    }

    return this.priceIdForPlan(plan);
  }

  lookupKeyForPlan(plan: PlanTier): string {
    switch (plan) {
      case PlanTier.STARTER:
        return 'consentmd_starter';
      case PlanTier.PRO:
        return 'consentmd_pro';
      case PlanTier.ENTERPRISE:
        return 'consentmd_enterprise';
      default:
        throw new Error(`Unknown plan: ${plan}`);
    }
  }

  async createCustomer(params: {
    email: string;
    organizationId: string;
    tenant?: string;
    name?: string;
  }): Promise<Stripe.Customer> {
    return this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: {
        organizationId: params.organizationId,
        ...(params.tenant ? { tenant: params.tenant } : {}),
      },
    });
  }

  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    organizationId: string;
    plan: PlanTier;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl.includes('{CHECKOUT_SESSION_ID}')
        ? params.successUrl
        : `${params.successUrl}${params.successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: params.cancelUrl,
      subscription_data: {
        metadata: {
          organizationId: params.organizationId,
          plan: params.plan,
        },
      },
      metadata: {
        organizationId: params.organizationId,
        plan: params.plan,
      },
    });
  }

  async updateSubscriptionPlan(params: {
    subscriptionId: string;
    priceId: string;
    plan: PlanTier;
    organizationId: string;
  }): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.retrieve(
      params.subscriptionId,
    );
    const itemId = subscription.items.data[0]?.id;

    if (!itemId) {
      throw new Error('Subscription has no items to update');
    }

    return this.stripe.subscriptions.update(params.subscriptionId, {
      items: [{ id: itemId, price: params.priceId }],
      proration_behavior: 'create_prorations',
      metadata: {
        organizationId: params.organizationId,
        plan: params.plan,
      },
    });
  }

  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<Stripe.BillingPortal.Session> {
    return this.stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.apiConfig.stripeWebhookSecret,
    );
  }
}
