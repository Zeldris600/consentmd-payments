import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import {
  decodeAccessTokenPayload,
  userFromAccessTokenClaims,
} from '../../common/utils/jwt-payload.util';
import { ApiConfigService } from '../../config/api-config.service';
import { IdpService } from '../idp/idp.service';
import { DevLoginDto } from './dto/dev-login.dto';

export interface DevLoginUser {
  id: string;
  email: string;
  role: string;
  first_name?: string | null;
  last_name?: string | null;
  organization_id?: string | number | null;
  tenant_id?: string | null;
}

/** Trimmed dev-login payload — no duplicate top-level user fields. */
export interface DevLoginResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  user: DevLoginUser;
}

export interface DevAuthProxyResult<T = unknown> {
  data: T;
  status: number;
}

@Injectable()
export class DevAuthService {
  private readonly logger = new Logger(DevAuthService.name);

  private static readonly LOGIN_PATH = '/api/auth/email-login';

  constructor(
    private readonly apiConfig: ApiConfigService,
    private readonly idpService: IdpService,
  ) {}

  async login(
    dto: DevLoginDto,
  ): Promise<DevAuthProxyResult<DevLoginResponse | unknown>> {
    const path = DevAuthService.LOGIN_PATH;
    const url = `${this.apiConfig.laravelBaseUrl}${path}`;

    const { data, status } = await this.postToIdp<unknown>(path, {
      email: dto.email,
      password: dto.password,
    });

    if (status >= 200 && status < 400) {
      const normalized = this.normalizeLoginResponse(data);
      this.logger.log(
        `Dev IdP login succeeded for ${dto.email} via ${path} (user id=${normalized.user.id})`,
      );
      return { data: normalized, status };
    }

    this.logger.warn(
      [
        `Dev IdP login failed for ${dto.email}`,
        `→ POST ${url}`,
        `→ HTTP ${status}`,
        `→ body: ${this.formatResponseBody(data)}`,
        this.hintForLoginFailure(status, data),
      ]
        .filter(Boolean)
        .join('\n'),
    );

    return { data, status };
  }

  private normalizeLoginResponse(data: unknown): DevLoginResponse {
    const raw =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {};

    const nestedUser =
      raw.user && typeof raw.user === 'object'
        ? (raw.user as Record<string, unknown>)
        : null;

    const accessToken =
      typeof raw.access_token === 'string' ? raw.access_token : '';
    const claims = accessToken
      ? decodeAccessTokenPayload(accessToken)
      : null;
    const fromClaims = claims ? userFromAccessTokenClaims(claims) : null;

    const organizationId = this.coerceOrgId(
      raw.organization_id ??
        nestedUser?.organization_id ??
        fromClaims?.organization_id,
    );

    const tenantId =
      (typeof raw.tenant_id === 'string' ? raw.tenant_id : null) ??
      fromClaims?.tenant_id ??
      null;

    const user: DevLoginUser = {
      id: String(raw.id ?? nestedUser?.id ?? fromClaims?.id ?? ''),
      email: String(raw.email ?? nestedUser?.email ?? fromClaims?.email ?? ''),
      role: String(raw.role ?? nestedUser?.role ?? fromClaims?.role ?? ''),
      organization_id: organizationId,
      tenant_id: tenantId,
      first_name:
        typeof nestedUser?.first_name === 'string'
          ? nestedUser.first_name
          : null,
      last_name:
        typeof nestedUser?.last_name === 'string' ? nestedUser.last_name : null,
    };

    return {
      access_token: accessToken,
      ...(typeof raw.token_type === 'string'
        ? { token_type: raw.token_type }
        : {}),
      ...(typeof raw.expires_in === 'number'
        ? { expires_in: raw.expires_in }
        : {}),
      user,
    };
  }

  private coerceOrgId(
    value: unknown,
  ): string | number | null | undefined {
    if (value == null) {
      return null;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    return null;
  }

  async getMe(bearerToken: string) {
    return this.idpService.getCurrentUser(bearerToken);
  }

  private hintForLoginFailure(status: number, data: unknown): string {
    const error =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : undefined;

    if (status === 403 && error === 'User not found') {
      return '→ hint: legacy `/api/sign-in` returns this; this service uses `/api/auth/email-login`.';
    }
    if (status === 401 && error === 'invalid_credentials') {
      return '→ hint: user exists but email/password did not match.';
    }
    if (status === 429) {
      return '→ hint: Laravel rate limit — wait and retry.';
    }
    if (status === 422 || error?.toLowerCase().includes('turnstile')) {
      return '→ hint: Turnstile CAPTCHA may be required for browser login.';
    }
    return '';
  }

  private formatResponseBody(data: unknown): string {
    if (data == null) {
      return '(empty)';
    }
    if (typeof data === 'string') {
      return data.slice(0, 500);
    }
    try {
      return JSON.stringify(data).slice(0, 1000);
    } catch {
      return String(data);
    }
  }

  private async postToIdp<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<DevAuthProxyResult<T>> {
    const url = `${this.apiConfig.laravelBaseUrl}${path}`;

    try {
      const response = await axios.post<T>(url, body, {
        headers: { Accept: 'application/json' },
        timeout: this.apiConfig.laravelHttpTimeoutMs,
        validateStatus: () => true,
      });

      return { data: response.data, status: response.status };
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'ECONNABORTED') {
        throw new GatewayTimeoutException('IdP login request timed out');
      }
      this.logger.error(
        `IdP login transport error for POST ${url}: ${err?.message ?? 'unknown'}`,
      );
      throw new BadGatewayException('IdP login request failed');
    }
  }
}
