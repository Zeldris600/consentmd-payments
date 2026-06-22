export type BillingEmailType =
  | 'payment_failed'
  | 'grace_expiring'
  | 'suspended'
  | 'payment_recovered';

export interface BillingEmailJobPayload {
  organizationId: string;
  type: BillingEmailType;
  portalUrl?: string;
}

export interface GraceExpiryJobPayload {
  organizationId: string;
}
