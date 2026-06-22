import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ApiConfigService } from '../../config/api-config.service';
import { PlanTier } from './enums/plan-tier.enum';

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  monthlyPriceUsd: number | null;
  minSeats: number;
  maxSeats: number | null;
  stripePriceId?: string;
}

@Injectable()
export class PlanService {
  constructor(private readonly apiConfig: ApiConfigService) {}

  listPlans(): PlanDefinition[] {
    return [
      {
        tier: PlanTier.STARTER,
        name: 'Starter',
        monthlyPriceUsd: 250,
        minSeats: 1,
        maxSeats: 25,
        stripePriceId: this.apiConfig.stripePriceStarter,
      },
      {
        tier: PlanTier.PRO,
        name: 'Pro',
        monthlyPriceUsd: 450,
        minSeats: 26,
        maxSeats: 50,
        stripePriceId: this.apiConfig.stripePricePro,
      },
      {
        tier: PlanTier.ENTERPRISE,
        name: 'Enterprise',
        monthlyPriceUsd: 750,
        minSeats: 51,
        maxSeats: null,
        stripePriceId: this.apiConfig.stripePriceEnterprise,
      },
    ];
  }

  resolvePlanForSeatCount(seatCount: number): PlanTier {
    if (seatCount <= 25) return PlanTier.STARTER;
    if (seatCount <= 50) return PlanTier.PRO;
    return PlanTier.ENTERPRISE;
  }

  seatLimitForPlan(plan: PlanTier): number {
    switch (plan) {
      case PlanTier.STARTER:
        return 25;
      case PlanTier.PRO:
        return 50;
      case PlanTier.ENTERPRISE:
        return Number.MAX_SAFE_INTEGER;
      default:
        return 0;
    }
  }

  assertPlanMatchesSeats(plan: PlanTier, seatCount: number): void {
    const recommended = this.resolvePlanForSeatCount(seatCount);
    if (plan !== recommended) {
      throw new UnprocessableEntityException(
        `Plan "${plan}" does not match organization seat count (${seatCount}). Recommended plan: "${recommended}".`,
      );
    }
  }

  getPlanDefinition(plan: PlanTier): PlanDefinition {
    const found = this.listPlans().find((p) => p.tier === plan);
    if (!found) {
      throw new UnprocessableEntityException(`Unknown plan: ${plan}`);
    }
    return found;
  }
}
