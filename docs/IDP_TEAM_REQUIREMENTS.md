# IdP ↔ payments integration status

**Audience:** Laravel / central IdP team & payments maintainers  
**Service:** `consentmd-payments`  
**Last updated:** June 2026

---

## Summary

The payments microservice integrates with Laravel via:

1. **User JWT** — Passport tokens from `POST /api/auth/email-login`, verified with `LARAVEL_JWT_PUBLIC_KEY`
2. **Internal API** — machine key `CONSENTMD_INTERNAL_API_KEY` → `GET /api/internal/*`

---

## IdP endpoints consumed by payments

| Purpose | Endpoint | Auth |
|---------|----------|------|
| Current user (Passport) | `GET /api/auth/me` | User bearer JWT |
| Resolve org by id | `GET /api/internal/organizations/{id}` | Internal API key |
| Resolve org by tenant slug | `GET /api/internal/organizations?tenant_id=` | Internal API key |
| Live member count | `member_count` on internal org | Internal API key |
| Org admin check | `GET /api/internal/organizations/{id}/admins/{user_id}` | Internal API key |
| Dev login proxy | `POST /api/auth/email-login` | Email/password (DEV only) |

### Deprecated / not used by payments

| Endpoint | Reason |
|----------|--------|
| `GET /api/me` | Does not resolve tenant-scoped Passport tokens |
| `GET /api/organizations/{id}/members` | Replaced by internal `member_count` |
| `POST /api/sign-in` | Superseded by `email-login` |

---

## Payments behaviour

### Organization reference

`organizationId` in billing requests may be:

- numeric central org id (`12`), or
- tenant slug (`consent-m-d-demo`) → resolved via internal list API

### Seat count

Uses `member_count` from `GET /api/internal/organizations/{id}`.

If `member_count` is `null`, checkout/upgrade returns **422** with a retry message (no fake defaults).

### Org admin

Uses `GET /api/internal/organizations/{id}/admins/{user_id}` where `user_id` is the JWT `sub` claim.

Platform `role: admin` still passes without the internal call.

### User profile

Uses `GET /api/auth/me` (`{ data: { id, email, role, organization_id, tenant_id, ... } }`).

JWT claim fallback only when `/api/auth/me` returns 401 (e.g. tokens minted before `tenant_id` claim — user must re-login).

---

## Environment variables (payments)

| Variable | Purpose |
|----------|---------|
| `LARAVEL_BASE_URL` | Central Laravel app URL |
| `LARAVEL_JWT_PUBLIC_KEY` | RS256 PEM for Passport JWT verification |
| `CONSENTMD_INTERNAL_API_KEY` | Must match a key in Laravel `INTERNAL_API_KEYS` |
| `INTERNAL_API_KEY` | Inbound key for node-backend → payments entitlement API (separate) |

---

## Staging test checklist

| # | Step | Expected |
|---|------|----------|
| 1 | `POST /api/auth/email-login` | 200 + `access_token` with `tenant_id` claim |
| 2 | `GET /api/auth/me` with that token | 200 + `data.email`, `data.tenant_id` |
| 3 | `GET /api/internal/organizations?tenant_id=consent-m-d-demo` | 200 + org(s) with `member_count` |
| 4 | `GET /api/internal/organizations/{id}/admins/{sub}` | 200 + `is_admin: true` for demo admin |
| 5 | Payments `POST /api/billing/checkout` with `organizationId: "consent-m-d-demo"` | 200 + `checkoutUrl` |

---

## Historical context (resolved)

### Why legacy `/api/me` returned 401

Email-login mints Passport tokens in the **tenant** DB; legacy `auth:api` on the central domain only checked the central `oauth_access_tokens` table. `GET /api/auth/me` fixes this via `AccessTokenResolver` + `tenant_id` claim.

### Previous payments workarounds (removed)

- JWT-only profile when `/api/me` failed
- DEV seat count default of `1`
- Members API for admin/seat checks

---

## Open items

| Item | Status |
|------|--------|
| Stripe `stripe_customer_id` ownership sync | TBD — payments creates Stripe customers; confirm if IdP column should be updated |
| Multi-org per tenant disambiguation | Payments returns 422; frontend should pass numeric `organizationId` |

---

## Billing enforcement (payments → IdP)

When renewal payment fails, payments starts a **grace period** (`BILLING_GRACE_PERIOD_DAYS`, default 7). Entitlement stays `active: true` until grace expires. After grace, payments suspends the org and reduces seats.

### Required IdP endpoint (new)

```
PATCH /api/internal/organizations/{id}/billing-status
Authorization: Bearer <CONSENTMD_INTERNAL_API_KEY>
Content-Type: application/json
```

**Request body:**

```json
{
  "billing_status": "active",
  "maximum_member_count": 25,
  "reason": "invoice_payment_failed"
}
```

| `billing_status` | When payments sends it | IdP should |
|------------------|------------------------|------------|
| `grace` | `invoice.payment_failed` / subscription `past_due` | Flag org as billing grace; optional banner; do **not** block access |
| `suspended` | Grace period expired | Suspend org login / premium features; enforce `maximum_member_count` |
| `active` | `invoice.paid` or subscription recovered | Clear suspension; restore `maximum_member_count` to plan limit |

**Response:** `200` with updated org, or `404` if not implemented (payments logs a warning and continues local enforcement).

Until this endpoint exists, grace/suspension still applies via the payments entitlement API (`active`, `gracePeriodEnd`, `suspended`, reduced `seatLimit`).

---

## References

- Payments integration: [`INTEGRATION.md`](./INTEGRATION.md)
- Local setup: [`LOCAL_DEVELOPMENT.md`](./LOCAL_DEVELOPMENT.md)
