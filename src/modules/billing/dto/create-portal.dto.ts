import { IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePortalDto {
  @ApiProperty({
    description:
      'Laravel organization id (numeric) or tenant slug. Resolved via internal API when configured.',
    example: 'consent-m-d-demo',
  })
  @IsString()
  organizationId: string;

  @ApiProperty({
    description: 'URL to return to after the user leaves the Stripe Customer Portal',
    example: 'http://localhost:3000/settings/billing',
  })
  @IsUrl({ require_tld: false })
  returnUrl: string;
}
