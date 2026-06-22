import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import axios from 'axios';
import {
  decodeAccessTokenPayload,
  userFromAccessTokenClaims,
} from '../../common/utils/jwt-payload.util';
import { ApiConfigService } from '../../config/api-config.service';

export interface IdpUser {
  id: string;
  email: string;
  role?: string;
  first_name?: string | null;
  last_name?: string | null;
  organization_id?: string | number | null;
  tenant_id?: string | null;
  /** @deprecated use tenant_id */
  tenant?: string | { id?: string; name?: string } | null;
}

export interface IdpOrganization {
  id: string | number;
  tenant_id?: string;
  name?: string;
  billing_email?: string;
  type?: string;
  stripe_customer_id?: string | null;
  plan?: string;
  minimum_member_count?: number;
  maximum_member_count?: number;
  member_count?: number | null;
}

export interface ResolvedOrganization {
  organizationId: string;
  organization: IdpOrganization;
  resolvedVia: 'id' | 'tenant_id';
}

export type IdpBillingStatus = 'active' | 'grace' | 'suspended';

export interface IdpBillingStatusPayload {
  billing_status: IdpBillingStatus;
  maximum_member_count?: number;
  reason?: string;
}

interface AuthMeEnvelope {
  data: IdpUser;
}

interface InternalOrganizationEnvelope {
  data: IdpOrganization;
}

interface InternalOrganizationListEnvelope {
  data: IdpOrganization[];
  meta?: {
    current_page?: number;
    last_page?: number;
    per_page?: number;
    total?: number;
  };
}

interface InternalAdminCheckEnvelope {
  data: {
    organization_id: number | string;
    user_id: string;
    is_admin: boolean;
    platform_admin?: boolean;
    membership_role?: string | null;
  };
}

@Injectable()
export class IdpService {
  private readonly logger = new Logger(IdpService.name);

  constructor(private readonly apiConfig: ApiConfigService) {}

  async getOrganization(
    organizationRef: string,
    bearerToken?: string,
  ): Promise<IdpOrganization | null> {
    if (this.apiConfig.consentmdInternalApiKey) {
      try {
        return (await this.resolveOrganizationReference(organizationRef))
          .organization;
      } catch (error) {
        if (error instanceof NotFoundException) {
          return null;
        }
        throw error;
      }
    }

    if (!bearerToken) {
      throw new BadGatewayException(
        'Organization lookup requires CONSENTMD_INTERNAL_API_KEY or a user bearer token',
      );
    }

    return this.getOrganizationWithUserToken(bearerToken, organizationRef);
  }

  async resolveOrganizationReference(
    ref: string,
  ): Promise<ResolvedOrganization> {
    const trimmed = ref.trim();
    if (!trimmed) {
      throw new NotFoundException('organizationId is required');
    }

    if (!this.apiConfig.consentmdInternalApiKey) {
      throw new BadGatewayException(
        'Organization resolution by tenant_id requires CONSENTMD_INTERNAL_API_KEY',
      );
    }

    if (/^\d+$/.test(trimmed)) {
      const byId = await this.getOrganizationInternal(trimmed);
      if (byId) {
        return {
          organizationId: String(byId.id),
          organization: byId,
          resolvedVia: 'id',
        };
      }
    }

    const byTenant = await this.listOrganizationsInternal({
      tenant_id: trimmed,
    });

    if (byTenant.length === 1) {
      const organization = byTenant[0];
      return {
        organizationId: String(organization.id),
        organization,
        resolvedVia: 'tenant_id',
      };
    }

    if (byTenant.length > 1) {
      throw new UnprocessableEntityException(
        `Multiple organizations match tenant_id "${trimmed}". Pass the numeric organization id instead (ids: ${byTenant.map((o) => o.id).join(', ')}).`,
      );
    }

    const byId = await this.getOrganizationInternal(trimmed);
    if (byId) {
      return {
        organizationId: String(byId.id),
        organization: byId,
        resolvedVia: 'id',
      };
    }

    throw new NotFoundException(
      `No organization found for id or tenant_id "${trimmed}"`,
    );
  }

  async getCurrentUser(bearerToken: string): Promise<IdpUser> {
    const { data, status } = await this.requestWithUserToken<AuthMeEnvelope>(
      'GET',
      '/api/auth/me',
      bearerToken,
    );

    if (status === 200 && data.data) {
      return this.normalizeAuthMeUser(data.data);
    }

    if (status === 401) {
      const claims = decodeAccessTokenPayload(bearerToken);
      if (claims?.sub && claims.email) {
        this.logger.debug(
          'IdP GET /api/auth/me returned 401; using JWT claims (re-login if token predates tenant_id claim)',
        );
        return this.normalizeAuthMeUser(userFromAccessTokenClaims(claims));
      }
      throw new UnauthorizedException('Bearer token rejected by IdP');
    }

    if (status >= 400) {
      throw new BadGatewayException('Failed to fetch current user from IdP');
    }

    throw new BadGatewayException('Unexpected IdP response for GET /api/auth/me');
  }

  async getOrganizationMemberCount(
    _bearerToken: string,
    organizationRef: string,
  ): Promise<number> {
    if (!this.apiConfig.consentmdInternalApiKey) {
      throw new BadGatewayException(
        'Seat count validation requires CONSENTMD_INTERNAL_API_KEY and GET /api/internal/organizations/{id}',
      );
    }

    const resolved = await this.resolveOrganizationReference(organizationRef);
    const count = resolved.organization.member_count;

    if (typeof count === 'number') {
      return count;
    }

    throw new UnprocessableEntityException(
      `Member count unavailable for organization ${resolved.organizationId} (IdP returned member_count=null). Retry later or check tenant DB connectivity.`,
    );
  }

  async isOrgAdmin(
    bearerToken: string,
    organizationRef: string,
  ): Promise<boolean> {
    const claims = decodeAccessTokenPayload(bearerToken);
    if (this.isPlatformAdminRole(claims?.role)) {
      return true;
    }

    let organizationId = organizationRef;
    if (this.apiConfig.consentmdInternalApiKey) {
      try {
        organizationId = (
          await this.resolveOrganizationReference(organizationRef)
        ).organizationId;
      } catch {
        // probe with original ref below
      }
    }

    const userId = await this.resolveUserIdForAdminCheck(bearerToken, claims);

    if (this.apiConfig.consentmdInternalApiKey && userId) {
      const admin = await this.checkOrgAdminInternal(organizationId, userId);
      if (admin != null) {
        return admin;
      }
    }

    const me = await this.getCurrentUser(bearerToken);
    if (this.isPlatformAdminRole(me.role)) {
      return true;
    }

    return false;
  }

  /**
   * Sync billing enforcement state to Laravel (org suspension / seat cap).
   * Requires `PATCH /api/internal/organizations/{id}/billing-status` on the IdP.
   */
  async updateOrganizationBillingStatus(
    organizationId: string,
    payload: IdpBillingStatusPayload,
  ): Promise<boolean> {
    const { status } = await this.requestWithInternalKey<unknown>(
      'PATCH',
      `/api/internal/organizations/${encodeURIComponent(organizationId)}/billing-status`,
      { body: payload },
    );

    if (status === 404) {
      this.logger.warn(
        `IdP billing-status endpoint not found for org ${organizationId} — local enforcement only`,
      );
      return false;
    }

    if (status >= 400) {
      this.logger.error(
        `IdP billing-status PATCH failed for org ${organizationId} (HTTP ${status})`,
      );
      return false;
    }

    return true;
  }

  private async resolveUserIdForAdminCheck(
    bearerToken: string,
    claims: ReturnType<typeof decodeAccessTokenPayload>,
  ): Promise<string | undefined> {
    if (claims?.sub) {
      return claims.sub;
    }

    try {
      const me = await this.getCurrentUser(bearerToken);
      return me.id;
    } catch {
      return undefined;
    }
  }

  private async checkOrgAdminInternal(
    organizationId: string,
    userId: string,
  ): Promise<boolean | null> {
    const { data, status } =
      await this.requestWithInternalKey<InternalAdminCheckEnvelope>(
        'GET',
        `/api/internal/organizations/${encodeURIComponent(organizationId)}/admins/${encodeURIComponent(userId)}`,
      );

    if (status === 404) {
      return false;
    }
    if (status === 401) {
      throw new UnauthorizedException(
        'Laravel internal API rejected CONSENTMD_INTERNAL_API_KEY',
      );
    }
    if (status >= 400) {
      this.logger.warn(
        `Internal org admin check failed for org=${organizationId} user=${userId} status=${status}`,
      );
      return null;
    }

    return Boolean(data.data?.is_admin);
  }

  private normalizeAuthMeUser(user: IdpUser): IdpUser {
    const tenantId =
      user.tenant_id ??
      (typeof user.tenant === 'string'
        ? user.tenant
        : user.tenant?.id != null
          ? String(user.tenant.id)
          : null);

    return {
      ...user,
      ...(tenantId ? { tenant_id: tenantId, tenant: tenantId } : {}),
    };
  }

  private isPlatformAdminRole(role: string | undefined): boolean {
    return (role ?? '').toLowerCase() === 'admin';
  }

  private async listOrganizationsInternal(query: {
    tenant_id?: string;
    per_page?: number;
    page?: number;
  }): Promise<IdpOrganization[]> {
    const params: Record<string, string> = {};
    if (query.tenant_id) {
      params.tenant_id = query.tenant_id;
    }
    if (query.per_page != null) {
      params.per_page = String(query.per_page);
    }
    if (query.page != null) {
      params.page = String(query.page);
    }

    const { data, status } =
      await this.requestWithInternalKey<InternalOrganizationListEnvelope>(
        'GET',
        '/api/internal/organizations',
        { query: params },
      );

    if (status === 401) {
      throw new UnauthorizedException(
        'Laravel internal API rejected CONSENTMD_INTERNAL_API_KEY',
      );
    }
    if (status >= 400) {
      throw new BadGatewayException(
        'Failed to list organizations from Laravel internal API',
      );
    }

    return data.data ?? [];
  }

  private async getOrganizationInternal(
    organizationId: string,
  ): Promise<IdpOrganization | null> {
    const { data, status } =
      await this.requestWithInternalKey<InternalOrganizationEnvelope>(
        'GET',
        `/api/internal/organizations/${encodeURIComponent(organizationId)}`,
      );

    if (status === 404) {
      return null;
    }
    if (status === 401) {
      throw new UnauthorizedException(
        'Laravel internal API rejected CONSENTMD_INTERNAL_API_KEY',
      );
    }
    if (status >= 400) {
      throw new BadGatewayException(
        'Failed to fetch organization from Laravel internal API',
      );
    }

    return data.data ?? null;
  }

  private async getOrganizationWithUserToken(
    bearerToken: string,
    organizationId: string,
  ): Promise<IdpOrganization | null> {
    const { data, status } = await this.requestWithUserToken<{
      data?: IdpOrganization;
    } | null>('GET', `/api/organizations/${encodeURIComponent(organizationId)}`, bearerToken);
    if (status === 404) return null;
    if (status >= 400) {
      throw new BadGatewayException('Failed to fetch organization from IdP');
    }
    if (data && typeof data === 'object' && 'data' in data && data.data) {
      return data.data;
    }
    return data as IdpOrganization | null;
  }

  private async requestWithInternalKey<T>(
    method: 'GET' | 'PATCH' | 'POST',
    path: string,
    options?: {
      query?: Record<string, string>;
      body?: unknown;
    },
  ): Promise<{ data: T; status: number }> {
    const apiKey = this.apiConfig.consentmdInternalApiKey;
    if (!apiKey) {
      throw new BadGatewayException('CONSENTMD_INTERNAL_API_KEY is not configured');
    }

    const url = `${this.apiConfig.laravelBaseUrl}${path}`;

    try {
      const response = await axios.request<T>({
        method,
        url,
        params: options?.query,
        data: options?.body,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        timeout: this.apiConfig.laravelHttpTimeoutMs,
        validateStatus: () => true,
      });

      return { data: response.data, status: response.status };
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'ECONNABORTED') {
        throw new GatewayTimeoutException('Laravel internal API request timed out');
      }
      this.logger.error(
        `Laravel internal API request failed for ${path}: ${err?.message}`,
      );
      throw new BadGatewayException('Laravel internal API request failed');
    }
  }

  private async requestWithUserToken<T>(
    method: 'GET' | 'POST',
    path: string,
    bearerToken: string,
    query?: Record<string, string>,
  ): Promise<{ data: T; status: number }> {
    const url = `${this.apiConfig.laravelBaseUrl}${path}`;

    try {
      const response = await axios.request<T>({
        method,
        url,
        params: query,
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
        },
        timeout: this.apiConfig.laravelHttpTimeoutMs,
        validateStatus: () => true,
      });

      return { data: response.data, status: response.status };
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'ECONNABORTED') {
        throw new GatewayTimeoutException('IdP request timed out');
      }
      this.logger.error(`IdP request failed for ${path}: ${err?.message}`);
      throw new BadGatewayException('IdP request failed');
    }
  }
}

export class ForbiddenIdpError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'ForbiddenIdpError';
  }
}
