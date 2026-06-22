import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ApiConfigService } from '../../config/api-config.service';
import { IdpModule } from '../idp/idp.module';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OrgAdminGuard } from './org-admin.guard';
import { InternalApiKeyGuard } from './internal-api-key.guard';
import { DevOnlyGuard } from './guards/dev-only.guard';
import { DevAuthService } from './dev-auth.service';
import { DevAuthController } from './dev-auth.controller';

@Module({
  imports: [IdpModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [DevAuthController],
  providers: [
    ApiConfigService,
    JwtStrategy,
    JwtAuthGuard,
    OrgAdminGuard,
    InternalApiKeyGuard,
    DevOnlyGuard,
    DevAuthService,
  ],
  exports: [
    PassportModule,
    JwtAuthGuard,
    OrgAdminGuard,
    InternalApiKeyGuard,
    IdpModule,
  ],
})
export class AuthModule {}
