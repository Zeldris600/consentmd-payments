import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiConfigService } from '../../config/api-config.service';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly apiConfig: ApiConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.apiConfig.internalApiKey;
    if (!configured) {
      throw new UnauthorizedException('Internal API key is not configured');
    }

    const request = context.switchToHttp().getRequest<{
      headers?: { 'x-api-key'?: string };
    }>();
    const provided = request.headers?.['x-api-key'];
    if (!provided || provided !== configured) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    return true;
  }
}
