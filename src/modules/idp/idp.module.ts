import { Module } from '@nestjs/common';
import { ApiConfigService } from '../../config/api-config.service';
import { IdpService } from './idp.service';

@Module({
  providers: [IdpService, ApiConfigService],
  exports: [IdpService],
})
export class IdpModule {}
