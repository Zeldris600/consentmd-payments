import Stripe from 'stripe';

export interface StripeEventJobPayload {
  event: Stripe.Event;
}
