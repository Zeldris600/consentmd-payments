import { UnprocessableEntityException } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanTier } from './enums/plan-tier.enum';
import { ApiConfigService } from '../../config/api-config.service';

describe('PlanService', () => {
  const apiConfig = {
    stripePriceStarter: 'price_starter',
    stripePricePro: 'price_pro',
    stripePriceEnterprise: 'price_enterprise',
  } as ApiConfigService;

  const service = new PlanService(apiConfig);

  it('resolves starter for 1-25 seats', () => {
    expect(service.resolvePlanForSeatCount(1)).toBe(PlanTier.STARTER);
    expect(service.resolvePlanForSeatCount(25)).toBe(PlanTier.STARTER);
  });

  it('resolves pro for 26-50 seats', () => {
    expect(service.resolvePlanForSeatCount(26)).toBe(PlanTier.PRO);
    expect(service.resolvePlanForSeatCount(50)).toBe(PlanTier.PRO);
  });

  it('resolves enterprise for 51+ seats', () => {
    expect(service.resolvePlanForSeatCount(51)).toBe(PlanTier.ENTERPRISE);
  });

  it('rejects plan mismatch at checkout validation', () => {
    expect(() =>
      service.assertPlanMatchesSeats(PlanTier.STARTER, 30),
    ).toThrow(UnprocessableEntityException);
  });

  it('allows matching plan for seat count', () => {
    expect(() =>
      service.assertPlanMatchesSeats(PlanTier.PRO, 30),
    ).not.toThrow();
  });
});
