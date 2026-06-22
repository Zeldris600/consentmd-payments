import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ApiConfigService } from '../../config/api-config.service';
import { IdpService } from '../idp/idp.service';
import type { CurrentUserData } from './current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  laravelId?: string;
  organizationId?: string;
  organization_id?: string | number;
  tenant_id?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    apiConfig: ApiConfigService,
    private readonly idpService: IdpService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: apiConfig.jwtPublicKey,
      algorithms: ['RS256'],
      passReqToCallback: true,
    });
  }

  async validate(
    req: { headers?: { authorization?: string } },
    payload: JwtPayload,
  ): Promise<CurrentUserData> {
    const laravelId = payload.laravelId ?? payload.sub;
    const bearer = req.headers?.authorization?.replace(/^Bearer\s+/i, '').trim();

    let organizationId =
      payload.organizationId ??
      (payload.organization_id != null
        ? String(payload.organization_id)
        : undefined);

    let tenant =
      payload.tenant_id?.trim() ||
      undefined;

    if (bearer) {
      try {
        const me = await this.idpService.getCurrentUser(bearer);
        if (!organizationId && me.organization_id != null) {
          organizationId = String(me.organization_id);
        }
        if (me.tenant_id) {
          tenant = me.tenant_id.trim() || tenant;
        } else if (me.tenant != null) {
          tenant =
            typeof me.tenant === 'string'
              ? me.tenant.trim()
              : String((me.tenant as { id?: string }).id ?? '').trim() || tenant;
        }
      } catch (err) {
        this.logger.warn(
          `Could not enrich user from IdP for laravelId=${laravelId}: ${(err as Error).message}`,
        );
      }
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: (payload.role ?? '').toLowerCase(),
      laravelId,
      ...(organizationId ? { organizationId } : {}),
      ...(tenant ? { tenant } : {}),
    };
  }
}
