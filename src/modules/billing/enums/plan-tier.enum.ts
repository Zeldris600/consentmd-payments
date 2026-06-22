export enum PlanTier {
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  INCOMPLETE = 'incomplete',
  UNPAID = 'unpaid',
  /** Local enforcement after grace period expires (org suspended in IdP). */
  SUSPENDED = 'suspended',
}
