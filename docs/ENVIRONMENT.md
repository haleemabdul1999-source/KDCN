# Environment variables

Validated at start-up by `apps/api/src/config/env.ts` — the API refuses to start with an invalid
configuration (e.g. `PAYMENT_PROVIDER=mock` in production, or a malformed encryption key).

## API (`apps/api`)

| Variable                         | Required    | Default                   | Description                                                                                                                                                                                      |
| -------------------------------- | ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                       |             | `development`             | `development` \| `test` \| `production`                                                                                                                                                          |
| `PORT`                           |             | `4000`                    | HTTP port                                                                                                                                                                                        |
| `DATABASE_URL`                   | ✓           |                           | PostgreSQL URL. Add `?connection_limit=…&pool_timeout=…` to tune Prisma's pool; use `sslmode=require` for managed databases                                                                      |
| `WEB_BASE_URL`                   |             | `http://localhost:3000`   | Public web origin; used for payment callbacks and email links                                                                                                                                    |
| `API_BASE_URL`                   |             | `http://localhost:4000`   | Public API base (informational)                                                                                                                                                                  |
| `DATA_ENCRYPTION_KEY`            | ✓           |                           | 32 random bytes, base64. AES-256-GCM key for confidential fields and private documents. **Losing it makes encrypted data unrecoverable; rotating it requires re-encryption** (KNOWN_LIMITATIONS) |
| `APP_SECRET`                     | ✓           |                           | ≥32 chars; salts analytics visitor hashes. Must not contain `dev-only` in production                                                                                                             |
| `SESSION_TTL_HOURS`              |             | `336`                     | Customer/merchant session lifetime                                                                                                                                                               |
| `STAFF_SESSION_TTL_HOURS`        |             | `12`                      | Staff session lifetime                                                                                                                                                                           |
| `COOKIE_SECURE`                  |             | `true` in production      | Force `Secure` cookies                                                                                                                                                                           |
| `TRUST_PROXY`                    |             | `false`                   | Set `true` behind the web proxy / load balancer so client IPs (rate limits, audit) come from `X-Forwarded-For`                                                                                   |
| `PAYMENT_PROVIDER`               |             | `mock`                    | `mock` (dev/test only) \| `paystack`                                                                                                                                                             |
| `PAYSTACK_SECRET_KEY`            | if paystack |                           | `sk_test_…` or `sk_live_…`; also the webhook HMAC key                                                                                                                                            |
| `PAYSTACK_BASE_URL`              |             | `https://api.paystack.co` |                                                                                                                                                                                                  |
| `MOCK_PAYMENT_WEBHOOK_SECRET`    |             | dev value                 | HMAC key for the mock provider's webhooks                                                                                                                                                        |
| `STORAGE_DRIVER`                 |             | `local`                   | Only `local` in Release 1                                                                                                                                                                        |
| `STORAGE_LOCAL_DIR`              |             | `./storage`               | Persistent volume for media (`public/`) and encrypted documents (`private/`)                                                                                                                     |
| `MAX_UPLOAD_BYTES`               |             | `5242880`                 | Per-file limit after upload                                                                                                                                                                      |
| `NOTIFY_EMAIL_DRIVER`            |             | `log`                     | `log` (writes masked entries to logs; nothing delivered) \| `disabled`                                                                                                                           |
| `NOTIFY_SMS_DRIVER`              |             | `log`                     | as above                                                                                                                                                                                         |
| `CONFIRMATION_WINDOW_MINUTES`    |             | `1440`                    | Time for merchants to confirm availability                                                                                                                                                       |
| `PAYMENT_WINDOW_MINUTES`         |             | `360`                     | Time for customers to pay after confirmation                                                                                                                                                     |
| `AUTO_COMPLETE_DAYS`             |             | `3`                       | Days after delivery before auto-completion                                                                                                                                                       |
| `JOBS_ENABLED`                   |             | `true`                    | Run background jobs in this instance (lease-protected)                                                                                                                                           |
| `RATE_LIMIT_PER_MINUTE`          |             | `120`                     | Global per-IP limit                                                                                                                                                                              |
| `AUTH_RATE_LIMIT_PER_MINUTE`     |             | `10`                      | Login/registration/MFA/reset per IP                                                                                                                                                              |
| `CHECKOUT_RATE_LIMIT_PER_MINUTE` |             | `10`                      | Order placement per IP                                                                                                                                                                           |

### Seed-only (never set in production)

`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (bootstrap super-admin; MFA enrolled at first sign-in),
`SEED_ADMIN_TOTP_SECRET` (dev convenience: pre-enrols MFA), `SEED_DEMO=true` (demo merchants and
accounts; refused when `NODE_ENV=production`).

## Web (`apps/web`)

| Variable                  | Default                 | Description                                                                                           |
| ------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `API_INTERNAL_URL`        | `http://localhost:4000` | API base URL reachable from the web server (runtime; used by the `/api/*` proxy and server rendering) |
| `PORT` / `HOSTNAME`       | `3000` / `0.0.0.0`      | standalone server                                                                                     |
| `NEXT_TELEMETRY_DISABLED` |                         | set to `1`                                                                                            |

## Tests

`TEST_DATABASE_URL` (API integration tests, default `postgresql://kdcn:kdcn@localhost:5432/kdcn_test`),
`E2E_DATABASE_URL` (Playwright, default `…/kdcn_e2e`, should start empty), `PW_CHROMIUM_PATH`
(optional browser executable).

## Generating secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # DATA_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # APP_SECRET
```

Store production secrets in the hosting platform's secret manager — never in the repository or
images.
