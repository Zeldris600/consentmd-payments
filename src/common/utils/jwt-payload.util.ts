export interface AccessTokenClaims {
  sub: string;
  email?: string;
  role?: string;
  name?: string;
  organization_id?: string | number;
  organizationId?: string;
  tenant_id?: string;
  laravelId?: string;
}

/** Decode JWT payload without verification (use only after guard verification or as IdP fallback). */
export function decodeAccessTokenPayload(
  token: string,
): AccessTokenClaims | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as AccessTokenClaims;
    return payload?.sub ? payload : null;
  } catch {
    return null;
  }
}

export function userFromAccessTokenClaims(
  claims: AccessTokenClaims,
): {
  id: string;
  email: string;
  role?: string;
  organization_id?: string | number | null;
  tenant_id?: string | null;
} {
  return {
    id: claims.sub,
    email: claims.email ?? '',
    role: claims.role,
    organization_id: claims.organization_id ?? claims.organizationId ?? null,
    tenant_id: claims.tenant_id ?? null,
  };
}
