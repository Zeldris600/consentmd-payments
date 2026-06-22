export const STRIPE_EVENTS_QUEUE = 'stripe-events';

/** Bull job name — must match @Process() on StripeEventsProcessor. */
export const PROCESS_STRIPE_EVENT_JOB = 'process-stripe-event';

export const BILLING_LIFECYCLE_QUEUE = 'billing-lifecycle';

export const BILLING_GRACE_EXPIRY_JOB = 'grace-expiry';

export const BILLING_SEND_EMAIL_JOB = 'send-billing-email';
