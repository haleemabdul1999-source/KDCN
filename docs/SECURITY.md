# Security & compliance checklist

Legend: ✅ implemented and tested · 🟡 implemented, not independently verified / partial · ⬜ not done (owner action)

## Authentication & sessions

- ✅ scrypt password hashing (N=2¹⁷), min length 10 with letters+digits
- ✅ Account lockout (5 failures → 15 min); uniform error for unknown email; timing equalised
- ✅ Opaque server-side sessions, hashed at rest, HttpOnly + SameSite=Lax + Secure (prod), revocable
- ✅ Session rotation on login; revocation on logout, password change/reset, role change, suspension
- ✅ Staff MFA (TOTP, RFC 6238 vectors tested) required on every staff route
- ✅ Password reset: single-use, 30-minute, hashed tokens; no account enumeration
- ⬜ Email ownership verification at registration (KNOWN_LIMITATIONS)
- ⬜ MFA for merchant owners (recommended for payout changes)

## Authorisation

- ✅ Deny-by-default global guard; explicit `@Public()`
- ✅ Merchant-scoped and object-level checks (404 for foreign IDs) — Scenario D tests
- ✅ Staff roles separated (OPERATIONS / FINANCE / SUPPORT / SUPER_ADMIN); refund approval needs FINANCE
- ✅ Market operators limited to their market and aggregate metrics
- ✅ Customer contact/address disclosed to merchants only after payment

## Web & API hardening

- ✅ CSRF: custom header required on state-changing requests; CORS disabled; same-origin proxy
- ✅ Input validation (zod) on every body/query; parameterised SQL only (Prisma / tagged templates)
- ✅ Rate limiting (global, auth, checkout); webhooks exempt but signature-checked
- ✅ Helmet security headers on the API; CSP, frame-ancestors none, nosniff, referrer policy on web
- ✅ Errors never leak internals; request IDs for correlation
- ✅ Body size limits (256 KB JSON; uploads ≤10 MB transport, ≤5 MB stored)
- 🟡 In-memory rate limiter is per instance (move to edge/WAF when scaling out)
- 🟡 Web CSP allows `'unsafe-inline'` scripts (Next.js bootstrap); move to nonces

## Files

- ✅ Content sniffing (JPEG/PNG/WebP/PDF only), never trusting client MIME/extension
- ✅ EXIF/XMP (GPS) stripped from images
- ✅ Verification documents encrypted at rest (AES-256-GCM); served only to OPERATIONS/SUPER_ADMIN with audit
- ✅ Storage keys validated against a strict pattern (no traversal)
- ⬜ Malware scanning of uploads (add a scanning step with the S3 driver)

## Payments

- ✅ Server-side verification before PAID; amount & currency checked
- ✅ Webhook HMAC verification; durable de-duplication; duplicate/late payments auto-refunded
- ✅ No card data touches KDCN (hosted provider checkout) — PCI scope SAQ-A style
- 🟡 Paystack adapter not yet exercised against sandbox (PAYMENTS.md checklist)
- ⬜ Legal confirmation of settlement model (ADR 0006)

## Data protection (NDPA 2023 / NDPR) — design support

- ✅ Data minimisation (guest checkout needs only email + phone; merchants see contact after payment)
- ✅ Home-vendor residential addresses encrypted, never public, tested
- ✅ Analytics without IPs: daily-rotating salted visitor hash
- ✅ Account deletion with anonymisation; financial records retained without contact data
- ✅ Retention job: sessions (30 d after expiry), reset tokens (7 d), analytics (~13 months),
  notifications (12 months), abandoned guest carts (60 d), mock charges (30 d)
- ✅ Audit log of sensitive actions (append-only at DB level), including staff access to private data
- ⬜ Privacy notice, lawful-basis register, DPO/DPCO engagement, cross-border transfer assessment
  for hosting/providers, breach-notification procedure (72 h to NDPC) — owner actions
- ⬜ Retention periods for orders/payments/audit to be set by counsel (tax/financial record rules)

## Operations

- ✅ Environment validation; production refuses mock payments and dev secrets
- ✅ Structured JSON logs without secrets/addresses; recipient masking in notification logs
- ✅ Health/readiness endpoints; DB-leased jobs
- 🟡 Dockerfiles & compose written but **not built in this environment** (no Docker daemon)
- ⬜ Error monitoring (Sentry or similar) wiring, uptime checks, alert routing (OPERATIONS.md)
- ⬜ Backups/PITR enabled on the managed database; restore drill performed
- ⬜ Dependency/secret scanning in CI made blocking; penetration test before launch

## OWASP ASVS / Top 10 mapping (summary)

A01 Broken access control → guards + scoped queries + tests · A02 Crypto failures → scrypt, AES-GCM,
TLS at edge · A03 Injection → zod + parameterised queries · A04 Insecure design → state machine,
idempotency, threat-driven tests · A05 Misconfiguration → env validation, headers · A06 Vulnerable
components → pinned versions, `pnpm audit` in CI · A07 Auth failures → lockout, MFA, sessions ·
A08 Integrity → webhook signatures, append-only audit · A09 Logging → structured logs + audit ·
A10 SSRF → no user-controlled outbound URLs.
