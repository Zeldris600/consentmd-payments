# Local development

Step-by-step setup for running `consentmd-payments` on your machine with Docker, Stripe test mode, and webhook forwarding.

## Prerequisites

- Docker & Docker Compose
- A [Neon](https://neon.tech) (or local) PostgreSQL database
- Stripe **test mode** secret key from [Dashboard → API keys](https://dashboard.stripe.com/test/apikeys)
- Laravel IdP **JWT public key** (RS256 PEM) — same key used by `consentmd-node-backend`

## 1. Environment file

```bash
cp .env.example .env
```

### Required variables

| Variable | Where to get it |
|----------|-----------------|
| `DATABASE_URL` | Neon connection string; include `?sslmode=require` |
| `LARAVEL_JWT_PUBLIC_KEY` | PEM public key from Laravel IdP / `consentmd-node-backend` `.env` |
| `STRIPE_SECRET_KEY` | [Stripe test secret key](https://dashboard.stripe.com/test/apikeys) (`sk_test_...`, full value) |
| `STRIPE_WEBHOOK_SECRET` | Stripe CLI `stripe listen` output, or Dashboard webhook signing secret (`whsec_...`) |
| `CORS_ORIGIN` | Frontend origin, e.g. `http://localhost:3000` |

### Optional but recommended

| Variable | Purpose |
|----------|---------|
| `STRIPE_PRICE_STARTER` / `PRO` / `ENTERPRISE` | Fallback price IDs if lookup-key resolution fails |
| `CONSENTMD_INTERNAL_API_KEY` | Machine key for Laravel `GET /api/internal/organizations/*` (from Laravel `INTERNAL_API_KEYS`) |
| `INTERNAL_API_KEY` | Optional — key node-backend uses to call this service's entitlement endpoint |
| `LARAVEL_BASE_URL` | Central Laravel app URL (same host as `/api/internal`) |

The app validates env at startup. Empty or placeholder Stripe values fail fast with explicit messages instead of a cryptic Stripe SDK error.

## 2. Stripe test catalog

Prices are resolved by **lookup key** first (`consentmd_starter`, `consentmd_pro`, `consentmd_enterprise`), then env price IDs.

Provision test-mode catalog:

```bash
STRIPE_SECRET_KEY=sk_test_... pnpm exec ts-node scripts/provision-stripe-test-catalog.ts
```

Paste the printed price IDs into `.env`. The script refuses `sk_live_` keys.

| Lookup key | Plan | Amount |
|------------|------|--------|
| `consentmd_starter` | Starter | $250/mo |
| `consentmd_pro` | Pro | $450/mo |
| `consentmd_enterprise` | Enterprise | $750/mo |

## 3. Stripe CLI (webhooks)

Webhooks must reach your local app. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli):

```bash
# Linux — user install (no sudo)
mkdir -p ~/.local/bin
curl -fsSL "https://github.com/stripe/stripe-cli/releases/latest/download/stripe_1.42.10_linux_x86_64.tar.gz" \
  | tar -xz -C /tmp stripe && mv /tmp/stripe ~/.local/bin/stripe
export PATH="$HOME/.local/bin:$PATH"

stripe login
```

Forward events to the payments service (keep this terminal open):

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

Copy the printed signing secret (`whsec_...`) into `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the app.

> **Important:** Each `stripe listen` session may issue a **new** secret. Update `.env` if you restart the CLI.

For deployed environments, create a webhook endpoint in the [Stripe Dashboard](https://dashboard.stripe.com/test/webhooks) pointing at `https://<host>/api/webhooks/stripe` and use its signing secret instead.

## 4. Start the stack

```bash
docker compose -f docker-compose.dev.yml up --build
```

Docker Compose runs:

- **app** — NestJS on port `3001`, hot reload, `.env` via `env_file`
- **redis** — `redis:7-alpine` for the `stripe-events` Bull queue

Verify:

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/billing/plans
```

Swagger: http://localhost:3001/api/docs

## 5. Dev login (get a JWT for Swagger)

When `NODE_ENV=DEV`, the service exposes a convenience proxy to the Laravel IdP so you do not need the frontend or `consentmd-node-backend` just to obtain a bearer token.

### Option A — Swagger UI

1. Open http://localhost:3001/api/docs
2. Expand **dev-auth** → `POST /api/dev/auth/login`
3. Execute with your Laravel test user email/password
4. Copy `access_token` from the response
5. Click **Authorize** (top right) → paste `Bearer <access_token>` or just the token
6. Call protected billing routes (`checkout`, `subscription`, etc.)

Verify the token: **dev-auth** → `GET /api/dev/auth/me`

After login, payments calls `GET /api/auth/me` (Passport-compatible). Re-login if you have an old token from before `tenant_id` was embedded in JWTs.

**Checkout with tenant slug:** set `organizationId` to `consent-m-d-demo` (requires `CONSENTMD_INTERNAL_API_KEY`).

**Integration status:** [IDP_TEAM_REQUIREMENTS.md](./IDP_TEAM_REQUIREMENTS.md)

### Option B — curl

```bash
curl -s -X POST http://localhost:3001/api/dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}' \
  | jq -r '.access_token'
```

> These routes return **404** when `NODE_ENV` is not `DEV` (staging/production).

## 6. Test a checkout (manual)

1. Obtain a token via `POST /api/dev/auth/login` (see §5) or from the main ConsentMD app.
2. Call checkout as an **org owner/admin**:

```bash
curl -X POST http://localhost:3001/api/billing/checkout \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "<org-id>",
    "plan": "starter",
    "successUrl": "http://localhost:3000/billing/success",
    "cancelUrl": "http://localhost:3000/billing/cancel"
  }'
```

3. Open the returned `checkoutUrl` in a browser; use Stripe test card `4242 4242 4242 4242`.
4. Watch `stripe listen` for `checkout.session.completed`.
5. Poll subscription status:

```bash
curl "http://localhost:3001/api/billing/subscription?organizationId=<org-id>" \
  -H "Authorization: Bearer <token>"
```

## Running without Docker

```bash
pnpm install
# Start Redis locally (or point REDIS_HOST at a running instance)
pnpm run start:dev
```

Set `REDIS_HOST=localhost` in `.env` when not using Docker Compose.

## Troubleshooting

### `Neither apiKey nor config.authenticator provided`

`STRIPE_SECRET_KEY` is missing or empty in `.env`. Paste the full `sk_test_...` value and restart:

```bash
docker compose -f docker-compose.dev.yml up -d
```

### `Environment validation failed`

Read the bullet list in the error. Common causes:

- `STRIPE_SECRET_KEY` too short or missing `sk_test_` / `sk_live_` prefix
- `STRIPE_WEBHOOK_SECRET` empty or not starting with `whsec_`
- `LARAVEL_JWT_PUBLIC_KEY` empty

### `command not found: stripe`

Install the CLI (see §3) or use `~/.local/bin/stripe` with the full path.

### Webhook signature verification failed

`STRIPE_WEBHOOK_SECRET` does not match the CLI session or Dashboard endpoint. Re-copy from `stripe listen` output and restart the app.

### Checkout returns 422 — plan does not match seat count

The selected `plan` must match the org's current member count:

| Plan | Seats |
|------|-------|
| `starter` | 1–25 |
| `pro` | 26–50 |
| `enterprise` | 51+ |

### Checkout returns 422 — already has subscription

Use `POST /api/billing/upgrade` instead of checkout for plan changes.

### 403 — Caller must be organization owner or admin

`POST /checkout`, `POST /portal`, and `POST /upgrade` require the JWT bearer to be an org admin in the IdP.
