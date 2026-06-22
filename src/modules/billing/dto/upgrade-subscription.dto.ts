import { IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlanTier } from '../enums/plan-tier.enum';

export class UpgradeSubscriptionDto {
  @ApiProperty({
    description:
      'Laravel organization id (numeric) or tenant slug. Resolved via internal API when configured.',
    example: 'consent-m-d-demo',
  })
  @IsString()
  organizationId: string;

  @ApiProperty({
    enum: PlanTier,
    description:
      'New plan tier. Must match current org member count. Requires an existing Stripe subscription.',
    example: PlanTier.PRO,
  })
  @IsEnum(PlanTier)
  plan: PlanTier;
}
