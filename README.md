# KDCN — Kaduna Digital Commerce Network

A multi-merchant digital commerce platform for Kaduna State: one marketplace and one commerce
infrastructure for **shopping-mall stores (Galaxy Mall pilot), traditional market traders,
independent shops and home-based vendors**.

The merchant — not the physical market — is the primary commercial entity. Every merchant uses the
same catalogue, checkout, order, payment, fulfilment and settlement system; markets such as Galaxy
Mall are *collections* of affiliated merchants, not separate systems.

> **Status:** Release 1 (commercially testable MVP) implemented and tested against the
> **deterministic mock payment provider**. The Paystack adapter is implemented but **has not been
> exercised against the Paystack sandbox** (no network access to Paystack from the build
> environment). No production deployment has been made. See
> [`docs/ACCEPTANCE_REPORT.md`](docs/ACCEPTANCE_REPORT.md) and
> [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) before going live.

## What's in the box

| Area | Where |
| --- | --- |
| Customer marketplace (home, search, product, storefront, Galaxy Mall & market pages, cart, checkout, orders, tracking) | `apps/web/src/app` |
| Merchant dashboard (onboarding & verification, products, orders & fulfilment, payouts, customers, settings, staff) | `apps/web/src/app/merchant/[merchantId]` |
| KDCN admin (verification, moderation, orders, disputes, fulfilment, finance, analytics, audit, users) | `apps/web/src/app/admin` |
| Market operator portal | `apps/web/src/app/operator/[marketId]` |
| API — NestJS modular monolith | `apps/api/src` |
| Database schema & migrations — PostgreSQL / Prisma | `apps/api/prisma` |
| API tests (unit + integration for acceptance scenarios A–H) | `apps/api/test` |
| End-to-end browser tests (Playwright) | `apps/web/e2e` |
| Documentation | `docs/` |

## Stack

Next.js 15 (App Router, React 19, TypeScript) · NestJS 11 · PostgreSQL 16 · Prisma 6 ·
PostgreSQL full-text search + `pg_trgm` · Paystack (adapter) / deterministic mock provider ·
local encrypted object storage (S3 adapter planned) · Jest + Supertest · Playwright.

No Redis, Kafka, Elasticsearch or Kubernetes — see [ADR 0001](docs/adr/0001-modular-monolith.md).

## Quick start (local development)

Prerequisites: Node.js ≥ 22, pnpm 10, PostgreSQL 16 (with the `pg_trgm` extension available).

```bash
# 1. Database
createuser -P kdcn            # password: kdcn (or adjust DATABASE_URL)
createdb -O kdcn kdcn
createdb -O kdcn kdcn_test    # for the API test suite

# 2. Install
pnpm install

# 3. Configure the API
cp apps/api/.env.example apps/api/.env      # dev defaults; see docs/ENVIRONMENT.md

# 4. Migrate, build and seed (reference data + demo merchants/accounts)
pnpm --filter @kdcn/api db:migrate
pnpm --filter @kdcn/api build
pnpm --filter @kdcn/api db:seed

# 5. Run (API on :4000, web on :3000 — the web app proxies /api/* to the API)
pnpm --filter @kdcn/api start        # or: pnpm --filter @kdcn/api dev
pnpm --filter @kdcn/web dev
```

Open http://localhost:3000.

### Demo accounts (created by the seed when `SEED_DEMO=true`; never in production)

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@demo.kdcn.ng` | `Password123!` |
| Galaxy Mall merchant (Zainab Fabrics) | `galaxy.merchant@demo.kdcn.ng` | `Password123!` |
| Home vendor (Amina Bakes) | `home.vendor@demo.kdcn.ng` | `Password123!` |
| Independent shop (Kawo Gadgets Hub) | `independent@demo.kdcn.ng` | `Password123!` |
| Galaxy Mall operator | `operator@demo.kdcn.ng` | `Password123!` |
| KDCN super-admin | `admin@demo.kdcn.ng` | `AdminPassword123!` + TOTP |
| KDCN ops/support/finance | `ops@demo.kdcn.ng` | `Password123!` + TOTP |

Staff accounts require TOTP MFA. In development the seed pre-enrols the secret in
`SEED_ADMIN_TOTP_SECRET` (`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`) — add it to any authenticator app.

Payments use the **mock provider** by default: "Pay" opens a clearly-labelled TEST MODE page where
you choose success or failure. Verification, webhooks (HMAC-signed) and idempotency run exactly as
they would with a real provider. No money moves.

## Tests

```bash
pnpm --filter @kdcn/api test          # unit + integration (needs the kdcn_test database)
pnpm --filter @kdcn/api lint
pnpm -r typecheck

# End-to-end (builds required; uses an empty database named kdcn_e2e by default)
createdb -O kdcn kdcn_e2e
pnpm --filter @kdcn/api build && pnpm --filter @kdcn/web build
pnpm --filter @kdcn/web test:e2e      # set PW_CHROMIUM_PATH if Playwright's browser is preinstalled elsewhere
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) and [architecture decision records](docs/adr)
- [Data model](docs/DATA_MODEL.md) · [Order state machine](docs/ORDER_STATE_MACHINE.md)
- [Payments, refunds & settlement](docs/PAYMENTS.md) · [Fulfilment](docs/FULFILMENT.md)
- [Roles & permissions](docs/PERMISSIONS.md) · [Security & compliance checklist](docs/SECURITY.md)
- [API reference](docs/API.md) · [Environment variables](docs/ENVIRONMENT.md)
- [Analytics definitions](docs/ANALYTICS.md)
- [Deployment](docs/DEPLOYMENT.md) · [Operations, monitoring & recovery](docs/OPERATIONS.md)
- [Known limitations & technical debt](docs/KNOWN_LIMITATIONS.md) · [Roadmap](docs/ROADMAP.md)
- [MVP acceptance report](docs/ACCEPTANCE_REPORT.md)

## Decisions that need the business owner

These materially affect legal exposure, cost or commercial terms and were **not** decided by the
engineering team (defaults are documented, not assumed final):

1. **Settlement model** — provider split settlement (Paystack subaccounts; merchant paid directly)
   vs KDCN collecting and paying out (`MANUAL_RECORD`). The latter may require regulatory
   approval. See [`docs/PAYMENTS.md`](docs/PAYMENTS.md).
2. **Payment provider contract** (Paystack or Flutterwave) and live API keys.
3. **Commission and service-fee levels** (seeded defaults: 5% / ₦100; home vendors 4%; Galaxy Mall 4.5%).
4. **Refund & cancellation terms**, consumer-protection review (FCCPA 2018) and the NDPA 2023
   privacy notice / data-retention schedule.
5. **Galaxy Mall operating agreement**: operator data access, collection-desk operations.
6. **Logistics partner(s)** for KDCN-arranged delivery and home-vendor pickup.
