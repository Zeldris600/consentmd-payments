import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SyncCheckoutDto {
  @ApiProperty({
    example: 'cs_test_a1LgFHZKBkJUbHM6hKWGu1caH6CC5oxyIuMiEKChyg4AT3vM6J0YBd65HS',
    description: 'Stripe Checkout session ID from the success redirect URL',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^cs_(test|live)_/, {
    message: 'sessionId must be a Stripe Checkout session ID (cs_test_... or cs_live_...)',
  })
  sessionId!: string;
}
