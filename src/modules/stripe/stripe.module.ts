import { Module } from '@nestjs/common';
import { ApiConfigService } from '../../config/api-config.service';
import { StripeService } from './stripe.service';

@Module({
  providers: [StripeService, ApiConfigService],
  exports: [StripeService],
})
export class StripeModule {}
