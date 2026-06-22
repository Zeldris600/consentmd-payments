import { IsEnum, IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlanTier } from '../enums/plan-tier.enum';

export class CreateCheckoutDto {
  @ApiProperty({
    description:
      'Laravel organization id (numeric) or tenant slug (e.g. `consent-m-d-demo`). Slugs are resolved via `GET /api/internal/organizations?tenant_id=`.',
    example: 'consent-m-d-demo',
  })
  @IsString()
  organizationId: string;

  @ApiProperty({
    enum: PlanTier,
    description:
      'Subscription tier. Must match org member count: starter (1–25), pro (26–50), enterprise (51+)',
    example: PlanTier.STARTER,
  })
  @IsEnum(PlanTier)
  plan: PlanTier;

  @ApiProperty({
    description:
      'URL to redirect after successful payment. `{CHECKOUT_SESSION_ID}` is appended automatically if omitted.',
    example: 'http://localhost:3000/billing/success',
  })
  @IsUrl({ require_tld: false })
  successUrl: string;

  @ApiProperty({
    description: 'URL to redirect if the user cancels Checkout',
    example: 'http://localhost:3000/billing/cancel',
  })
  @IsUrl({ require_tld: false })
  cancelUrl: string;
}
