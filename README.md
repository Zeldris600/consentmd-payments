# ConsentMD Payments

NestJS microservice that manages **organization subscription billing** for the ConsentMD suite via Stripe. It authenticates users with **Laravel IdP JWTs** (RS256), reads org membership from the IdP, and owns the Stripe customer/subscription lifecycle.

| Concern | Owner |
|---------|--------|
| User login & JWT issuance | Laravel IdP |
| Org identity, member count, admin roles | Laravel IdP |
| Stripe customers, subscriptions, invoices | This service |
| Subscription state cache | PostgreSQL (Neon) |
| Async webhook processing | Redis + Bull |

## Quick start (Docker)

```bash
cp .env.example .env
# Fill in DATABASE_URL, LARAVEL_JWT_PUBLIC_KEY, Stripe keys (see docs/LOCAL_DEVELOPMENT.md)

docker compose -f docker-compose.dev.yml up --build
```

| URL | Purpose |
|-----|---------|
| `http://localhost:3001/api/health` | Health check |
| `http://localhost:3001/api/docs` | Swagger UI |
| `http://localhost:3001/api/billing/plans` | Public plan list |
| `POST http://localhost:3001/api/dev/auth/login` | DEV: Laravel login proxy → JWT for Swagger |

## Documentation

| Guide | Contents |
|-------|----------|
| [Local development](docs/LOCAL_DEVELOPMENT.md) | `.env` setup, Stripe CLI, test catalog, webhooks, common errors |
| [Integration guide](docs/INTEGRATION.md) | Architecture, auth, full API reference, frontend flows, node-backend migration |
| [IdP team requirements](docs/IDP_TEAM_REQUIREMENTS.md) | Gaps & API requests for Laravel (Passport, internal API, member count) |
| [`.env.example`](.env.example) | All environment variables |

## Scripts

```bash
pnpm install
pnpm run start:dev          # local (needs Redis + Postgres)
pnpm run test

# Provision Stripe TEST catalog (lookup keys + price IDs)
STRIPE_SECRET_KEY=sk_test_... pnpm exec ts-node scripts/provision-stripe-test-catalog.ts
```

## Stack

- **NestJS 11** · **TypeORM** · **PostgreSQL** · **Redis/Bull** · **Stripe SDK 19**
- Global API prefix: `/api`
- Swagger: `/api/docs`

## Related repos

- `consentmd-node-backend` — deprecate IdP billing proxy routes; call this service instead ([migration notes](../consentmd-node-backend/docs/PAYMENTS_SERVICE.md))
