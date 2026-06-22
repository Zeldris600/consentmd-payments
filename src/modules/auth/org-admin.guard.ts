import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { IdpService } from '../idp/idp.service';

@Injectable()
export class OrgAdminGuard implements CanActivate {
  constructor(private readonly idpService: IdpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      body?: { organizationId?: string };
      query?: { organizationId?: string };
      params?: { organizationId?: string };
    }>();

    const bearer = request.headers?.authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!bearer) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const organizationId =
      request.body?.organizationId ??
      request.query?.organizationId ??
      request.params?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('organizationId is required');
    }

    const isAdmin = await this.idpService.isOrgAdmin(bearer, organizationId);
    if (!isAdmin) {
      throw new ForbiddenException(
        'Caller must be organization owner or admin',
      );
    }

    return true;
  }
}
