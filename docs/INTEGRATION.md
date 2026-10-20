# ConsentMD Payments — Integration Guide

How other ConsentMD applications (frontend, `consentmd-node-backend`, internal services) integrate with the payments microservice.

**Local setup:** see [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)  
**API reference (share with integrators):** [API_REFERENCE.md](./API_REFERENCE.md)  
**Interactive API:** `{BASE_URL}/api/docs` (Swagger)

---

## What this service does

`consentmd-payments` is the **single source of truth for org subscription billing** in the ConsentMD suite.

- Creates Stripe customers and subscriptions for organizations
- Enforces plan tiers based on **live member count** from the Laravel IdP
- Exposes **entitlement** APIs so other apps can gate premium features
- Processes Stripe webhooks asynchronously and caches subscription state in PostgreSQL

It does **not** handle user login, per-consultation charges, or Laravel's legacy `setup-billing` / `billing-portal` proxy flows.

---

## Architecture

```
┌─────────────┐     JWT (RS256)      ┌──────────────────────┐
│  Frontend   │ ───────────────────► │ consentmd-payments   │
│  / Node API │                      │                      │
└─────────────┘                      │  BillingController   │
       │                             │  WebhooksController  │
       │                             └──────────┬───────────┘
       │                                        │
       │                             ┌──────────▼───────────┐
       │                             │ Laravel IdP          │
       └────────────────────────────►│ (org, members, admin)│
                                     └──────────────────────┘
                                                │
┌─────────────┐     webhooks           ┌────────▼───────────┐
│   Stripe    │ ────────────────────► │ Redis (Bull queue) │
└─────────────┘                       │ stripe-events worker│
                                      └────────┬───────────┘
                                               │
                                      ┌────────▼───────────┐
                                      │ PostgreSQL (Neon)   │
                                      │ organization_subs   │
                                      └────────────────────┘
```

### Stripe interaction model

| Action | Mechanism |
|--------|-----------|
| **First subscription** | Stripe Checkout Session (`POST /billing/checkout`) |
| **Plan change** | Stripe Subscriptions API (`POST /billing/upgrade`) — **not** Checkout |
| **Payment method / cancel / invoices** | Stripe Customer Portal (`POST /billing/portal`) |
| **State sync** | Webhooks → queue → Postgres cache |

Prices resolve by Stripe **lookup_key** (`consentmd_starter`, `consentmd_pro`, `consentmd_enterprise`), then fall back to `STRIPE_PRICE_*` env vars.

---

## Base URL

| Environment | Example |
|-------------|---------|
| Local | `http://localhost:3001` |
| Staging | `https://orvix.staging.consentmd.ai` |
| Production | `https://orvix.consentmd.ai` |

All routes are under the `/api` prefix.

**Frontend env suggestion:** `VITE_PAYMENTS_API_URL` or `NEXT_PUBLIC_PAYMENTS_API_URL`.

---

## Authentication

### User-facing routes (JWT)

Pass the same Laravel access token used across ConsentMD:

```http
Authorization: Bearer <laravel_access_token>
```

The service validates the JWT with `LARAVEL_JWT_PUBLIC_KEY` (RS256). It may call the IdP to enrich the user with `organizationId` and `tenant`.

### Machine-to-machine (Laravel internal API)

Server-side org lookups use Laravel's internal API — **not** user login:

```http
GET /api/internal/organizations/{id}
Authorization: Bearer <CONSENTMD_INTERNAL_API_KEY>
```

Configure `CONSENTMD_INTERNAL_API_KEY` in this service to match a key listed in Laravel's `INTERNAL_API_KEYS`. Used for `billing_email`, `stripe_customer_id`, `tenant_id`, etc. at checkout.

`organizationId` in billing requests may be a **numeric id** or a **tenant slug** (e.g. `consent-m-d-demo`). Slugs are resolved via `GET /api/internal/organizations?tenant_id=`.

See **[IDP_TEAM_REQUIREMENTS.md](./IDP_TEAM_REQUIREMENTS.md)** for open IdP API gaps (Passport `/api/me`, member count).

User JWT is required for authenticated billing routes. Server-side checks use:

- `GET /api/auth/me` — Passport-compatible user profile
- `GET /api/internal/organizations/{id}` — `member_count` for plan tier validation
- `GET /api/internal/organizations/{id}/admins/{user_id}` — org admin authorization

### Org admin routes

These endpoints additionally require the caller to be an **organization owner or admin** in the IdP for the `organizationId` in the request body:

- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `POST /api/billing/upgrade`

Returns `403 Forbidden` if the user is not an org admin.

### Service-to-service (internal API key)

```http
GET /api/billing/internal/entitlement/:organizationId
x-api-key: <INTERNAL_API_KEY>
```

Set the same `INTERNAL_API_KEY` in this service and the calling backend. No JWT required.

### Public routes

No authentication:

- `GET /api/health`
- `GET /api/billing/plans`

### Dev-only routes (`NODE_ENV=DEV`)

Convenience proxies for local testing — return **404** in staging/production:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/dev/auth/login` | Email/password → Laravel sign-in → `access_token` |
| `GET` | `/api/dev/auth/me` | Verify bearer token via Laravel `GET /api/me` |

Use the returned `access_token` in Swagger **Authorize** or `Authorization: Bearer` headers.

### Stripe webhooks

```http
POST /api/webhooks/stripe
stripe-signature: <signature>
```

Raw body is verified with `STRIPE_WEBHOOK_SECRET`. Not exposed in Swagger.

---

## API reference

### `GET /api/health`

Health check. No auth.

**Response `200`:**

```json
{ "status": "ok" }
```

---

### `GET /api/billing/plans` — public

Returns available subscription tiers for pricing UI. No auth required.

**Response `200`:**

```json
[
  {
    "tier": "starter",
    "name": "Starter",
    "monthlyPriceUsd": 250,
    "minSeats": 1,
    "maxSeats": 25,
    "stripePriceId": "price_..."
  },
  {
    "tier": "pro",
    "name": "Pro",
    "monthlyPriceUsd": 450,
    "minSeats": 26,
    "maxSeats": 50,
    "stripePriceId": "price_..."
  },
  {
    "tier": "enterprise",
    "name": "Enterprise",
    "monthlyPriceUsd": 750,
    "minSeats": 51,
    "maxSeats": null,
    "stripePriceId": "price_..."
  }
]
```

`stripePriceId` may be omitted if not configured in env (lookup keys still work at checkout time).

---

### `POST /api/billing/checkout` — JWT + org admin

Starts Stripe Checkout for a **new** organization subscription.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `organizationId` | string | yes | Laravel org ID |
| `plan` | `"starter"` \| `"pro"` \| `"enterprise"` | yes | Must match current seat count |
| `successUrl` | URL | yes | Redirect after successful payment (`{CHECKOUT_SESSION_ID}` appended if missing) |
| `cancelUrl` | URL | yes | Redirect if user cancels |

**Response `201`:**

```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
  "sessionId": "cs_test_..."
}
```

**Errors:**

| Status | When |
|--------|------|
| `401` | Missing or invalid JWT |
| `403` | Not org admin |
| `422` | Plan does not match org seat count |
| `422` | Org already has a Stripe subscription (use `/upgrade` instead) |

**Frontend flow:** redirect the browser to `checkoutUrl`. On return, poll `GET /subscription` until `entitlement.active` is `true`.

---

### `GET /api/billing/subscription` — JWT

Returns cached subscription record and computed entitlement.

**Query:** `organizationId` (required)

**Response `200` (no subscription yet):**

```json
{
  "organizationId": "42",
  "subscription": null,
  "entitlement": {
    "active": false,
    "plan": null,
    "seatLimit": 0,
    "seatCount": 12,
    "status": "none",
    "currentPeriodEnd": null
  }
}
```

**Response `200` (active subscription):**

```json
{
  "organizationId": "42",
  "subscription": {
    "id": "uuid",
    "organizationId": "42",
    "stripeCustomerId": "cus_...",
    "stripeSubscriptionId": "sub_...",
    "plan": "starter",
    "status": "active",
    "seatCount": 12,
    "seatLimit": 25,
    "currentPeriodEnd": "2026-07-09T00:00:00.000Z",
    "billingEmail": "billing@example.com",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "entitlement": {
    "active": true,
    "plan": "starter",
    "seatLimit": 25,
    "seatCount": 12,
    "status": "active",
    "currentPeriodEnd": "2026-07-09T00:00:00.000Z"
  }
}
```

`seatCount` is fetched from the IdP when a bearer token is present.

---

### `POST /api/billing/upgrade` — JWT + org admin

Changes plan on an **existing** Stripe subscription (prorated). Does not use Checkout.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `plan` | enum | yes |

**Response `200`:**

```json
{
  "organizationId": "42",
  "plan": "pro",
  "status": "active",
  "stripeSubscriptionId": "sub_..."
}
```

**Errors:**

| Status | When |
|--------|------|
| `404` | No existing Stripe subscription (use `/checkout` first) |
| `422` | Plan does not match seat count |

Typical trigger: org grows past seat limit (e.g. 26 members → must upgrade from `starter` to `pro`).

---

### `POST /api/billing/portal` — JWT + org admin

Creates a Stripe Customer Portal session for self-service billing management (payment methods, invoices, cancellation per Portal settings).

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `returnUrl` | URL | yes |

**Response `200`:**

```json
{ "url": "https://billing.stripe.com/p/session/..." }
```

Redirect the user to `url`.

**Errors:** `404` if no Stripe customer exists for the org.

---

### `GET /api/billing/entitlement/:organizationId` — JWT

Lightweight entitlement check for feature gating in user-facing apps.

**Response `200`:**

```json
{
  "active": true,
  "plan": "starter",
  "seatLimit": 25,
  "seatCount": 12,
  "status": "active",
  "currentPeriodEnd": "2026-07-09T00:00:00.000Z",
  "gracePeriodEnd": null,
  "suspended": false
}
```

| Field | Meaning |
|-------|---------|
| `active` | `true` when `active`/`trialing`, or `past_due` within grace period |
| `plan` | Current tier, or `null` |
| `seatLimit` | Max seats for current plan (reduced to `BILLING_SUSPENDED_SEAT_LIMIT` when suspended) |
| `seatCount` | Live member count from IdP (or cached value) |
| `status` | `active`, `past_due`, `suspended`, `canceled`, `incomplete`, `none`, etc. |
| `gracePeriodEnd` | ISO timestamp — full access until this time while `past_due` |
| `suspended` | `true` after grace expired and org was suspended |

**Gating recommendation:** require `active === true`. Warn when `seatCount` approaches or exceeds `seatLimit` and prompt upgrade. Show billing urgency when `status === 'past_due'` and `gracePeriodEnd` is set.

---

### `GET /api/billing/internal/entitlement/:organizationId` — `x-api-key`

Same response shape as the JWT entitlement endpoint, but for server-to-server calls. `seatCount` comes from the cached DB record (no IdP round-trip).

---

### `POST /api/webhooks/stripe` — Stripe signature

Ingress for Stripe events. Returns `{ "received": true }` immediately; processing is async.

**Handled event types:**

| Event | Effect |
|-------|--------|
| `checkout.session.completed` | Activate subscription, link Stripe IDs |
| `customer.subscription.updated` | Sync plan, status, period end |
| `customer.subscription.deleted` | Mark `canceled` |
| `invoice.paid` | Restore `active`, clear grace, notify IdP |
| `invoice.payment_failed` | Start grace period, email admin, sync IdP `grace` |

Configure in Stripe Dashboard (or use `stripe listen` locally). Subscribe to at least the events above.

---

## Subscription tiers

| Plan | `plan` value | Price | Seats | Lookup key |
|------|--------------|-------|-------|------------|
| Starter | `starter` | $250/mo | 1–25 | `consentmd_starter` |
| Pro | `pro` | $450/mo | 26–50 | `consentmd_pro` |
| Enterprise | `enterprise` | $750/mo (configurable) | 51+ | `consentmd_enterprise` |

At checkout/upgrade time, the service calls the IdP for member count and **rejects** a plan that does not match (`422`).

---

## Frontend integration

### Recommended billing UX flow

```
1. User signs in (existing Laravel IdP flow)
2. GET /api/billing/plans          → render pricing page (no auth)
3. GET /api/billing/subscription   → show current status if subscribed
4. GET IdP org member count        → highlight recommended tier
5. POST /api/billing/checkout      → redirect to checkoutUrl
6. On success URL: poll subscription until entitlement.active
7. "Manage billing" button         → POST /api/billing/portal → redirect to url
8. Seat growth past limit          → POST /api/billing/upgrade
```

### Example: fetch plans (public)

```typescript
const res = await fetch(`${PAYMENTS_API_URL}/api/billing/plans`);
const plans = await res.json();
```

### Example: start checkout

```typescript
const res = await fetch(`${PAYMENTS_API_URL}/api/billing/checkout`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    organizationId: org.id,
    plan: 'starter',
    successUrl: `${APP_URL}/billing/success`,
    cancelUrl: `${APP_URL}/billing/cancel`,
  }),
});
const { checkoutUrl } = await res.json();
window.location.href = checkoutUrl;
```

### Example: poll until active

```typescript
async function waitForActiveSubscription(orgId: string, token: string) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(
      `${PAYMENTS_API_URL}/api/billing/subscription?organizationId=${orgId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const { entitlement } = await res.json();
    if (entitlement.active) return entitlement;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Subscription not active yet');
}
```

---

## consentmd-node-backend migration

### Deprecate IdP billing proxies

These routes in `idp-proxy.controller.ts` should be removed or return `410 Gone`:

- `POST /api/organizations/:id/setup-billing`
- `GET /api/organizations/:id/billing-portal`

### Replace with payments service calls

| Old (IdP proxy) | New (payments service) |
|-----------------|------------------------|
| setup-billing | `POST /api/billing/checkout` |
| billing-portal | `POST /api/billing/portal` |
| — | `POST /api/billing/upgrade` |
| — | `GET /api/billing/entitlement/:organizationId` |

### Server-side feature gating

```http
GET /api/billing/internal/entitlement/{organizationId}
x-api-key: <INTERNAL_API_KEY>
```

See also: `consentmd-node-backend/docs/PAYMENTS_SERVICE.md`.

---

## Event-driven webhooks (queues)

Stripe requires a fast `200` response. This service enqueues every verified event:

```
Stripe → POST /api/webhooks/stripe
           → verify stripe-signature
           → Bull job (jobId = event.id for idempotency)
           → return { received: true }
                    ↓
         StripeEventsProcessor (worker)
                    ↓
         update organization_subscriptions in Postgres
```

Queue config: 5 retries, exponential backoff starting at 2s. Redis is required (`REDIS_HOST`).

Both `docker-compose.yml` and `docker-compose.dev.yml` include `redis:7-alpine`.

---

## Docker

### Development (hot reload + Redis)

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

### Production

```bash
cp .env.prod.example .env
docker compose up --build -d
```

Set `NODE_ENV=PROD`, use live Stripe keys, configure Dashboard webhooks to your public URL.

---

## Stripe catalog

### Test mode (local dev)

```bash
STRIPE_SECRET_KEY=sk_test_... pnpm exec ts-node scripts/provision-stripe-test-catalog.ts
```

### Live catalog (production — do not use in dev `.env`)

| Plan | Live price ID | Lookup key |
|------|---------------|------------|
| Starter | `price_1TgitcJ3ps64rGBcdq9bJxnZ` | `consentmd_starter` |
| Pro | `price_1TgitcJ3ps64rGBcsz9EMwTA` | `consentmd_pro` |
| Enterprise | `price_1TgitcJ3ps64rGBcqzaC7s2i` | `consentmd_enterprise` |

Product: `prod_Ug53PewktPYqEU` — **ConsentMD Platform Subscription**

---

## Stripe Dashboard checklist

1. [Customer Portal](https://dashboard.stripe.com/settings/billing/portal) — enable payment method updates, cancellation, invoice history
2. [Smart Retries](https://docs.stripe.com/billing/revenue-recovery) for failed payments
3. Webhook endpoint: `{BASE_URL}/api/webhooks/stripe`
4. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
5. Copy signing secret → `STRIPE_WEBHOOK_SECRET`

---

## Database

Subscription state is cached in PostgreSQL (`organization_subscriptions` table) via TypeORM.

- **DEV:** `synchronize: true` (schema auto-created)
- **Staging/Prod:** run migrations

```bash
DATABASE_URL="postgresql://..." pnpm exec typeorm-ts-node-commonjs migration:run -d data-source.ts
```

Connection string must include `?sslmode=require` for Neon.

---

## Environment variables

Full list in [`.env.example`](../.env.example). See [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for how to obtain each value.
