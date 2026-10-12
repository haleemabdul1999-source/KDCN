# Deployment

> No production deployment has been performed. Deploying or processing live payments requires the
> business owner's explicit authorisation, live provider credentials and the legal confirmations
> listed in the README.

## Recommended topology (managed services)

| Component      | Recommendation                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web            | Container (apps/web/Dockerfile, Next.js standalone) on a managed container platform (e.g. AWS App Runner/ECS Fargate, Google Cloud Run, Render, Fly.io) — 2 instances                               |
| API            | Container (apps/api/Dockerfile), 2 instances, **not publicly exposed** except `/api/payments/webhooks/*` via the web proxy                                                                          |
| Database       | Managed PostgreSQL 16 with automated daily backups + point-in-time recovery (≥7 days), `pg_trgm` enabled, TLS required                                                                              |
| Object storage | Release 1: persistent volume mounted at `STORAGE_LOCAL_DIR` (single API instance or shared filesystem). Before scaling the API horizontally, implement the S3-compatible driver (KNOWN_LIMITATIONS) |
| Edge           | TLS termination + WAF/rate limiting at the load balancer or CDN; HSTS; cache `/_next/static/*` and `/api/media/*`                                                                                   |
| Secrets        | Platform secret manager (`DATA_ENCRYPTION_KEY`, `APP_SECRET`, `PAYSTACK_SECRET_KEY`, `DATABASE_URL`)                                                                                                |
| Monitoring     | Error tracking (e.g. Sentry), uptime checks on `/api/health/ready`, log aggregation of JSON logs                                                                                                    |

Data residency: consider hosting in a region acceptable under NDPA cross-border transfer rules
(e.g. Africa (Cape Town/Lagos) regions where available) — owner decision.

## Images (unverified here — no Docker daemon in the build environment)

```bash
docker build -f apps/api/Dockerfile -t kdcn-api:$(git rev-parse --short HEAD) .
docker build -f apps/web/Dockerfile -t kdcn-web:$(git rev-parse --short HEAD) .
docker compose up --build        # local rehearsal with Postgres
```

## Release procedure

1. CI green on the commit (lint, typecheck, schema/migration sync, unit + integration, build, e2e).
2. Back up / snapshot the database (managed PITR also covers this).
3. **Release step:** run migrations once, before rolling out new API instances:
   `docker run --rm -e DATABASE_URL=… kdcn-api npx prisma migrate deploy`
   Migrations are forward-only; write additive migrations so old and new API versions can run
   side by side during rollout.
4. Roll out API, wait for `/api/health/ready` = 200, then roll out web.
5. Smoke test: home, search, product page, login, `GET /api/health/ready` shows the intended
   payment provider and `paymentTestMode` value.
6. First production bootstrap only: `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` → `node dist/seed/seed.js`
   (reference data + super-admin; **do not set `SEED_DEMO` or `SEED_ADMIN_TOTP_SECRET`**). Sign in,
   enrol MFA, then remove the seed variables.

## Required production settings

`NODE_ENV=production`, `PAYMENT_PROVIDER=paystack`, live/test key as authorised, `TRUST_PROXY=true`
(and the load balancer must append `X-Forwarded-For`), `WEB_BASE_URL=https://<domain>`, strong
secrets, `JOBS_ENABLED=true` on at least one API instance, Paystack webhook URL
`https://<domain>/api/payments/webhooks/paystack`.

## Rollback

Re-deploy the previous image tags. Because migrations are additive, the previous API version runs
against the newer schema. If a migration must be reversed, restore from PITR to a new instance and
cut over (data written since the restore point must be reconciled — avoid by keeping migrations
additive).
