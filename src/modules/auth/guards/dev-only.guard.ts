import {
  CanActivate,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiConfigService } from '../../../config/api-config.service';

/**
 * Restricts routes to NODE_ENV=DEV. Returns 404 elsewhere so dev helpers
 * are not discoverable in staging/production.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly apiConfig: ApiConfigService) {}

  canActivate(): boolean {
    if (this.apiConfig.nodeEnv !== 'DEV') {
      throw new NotFoundException();
    }
    return true;
  }
}
