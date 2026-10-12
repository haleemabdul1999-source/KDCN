# ADR 0003 — Server-side sessions, same-origin API, custom-header CSRF defence

**Status:** accepted

- **Sessions:** random 256-bit opaque tokens in an `HttpOnly; SameSite=Lax; Secure` cookie. Only
  the SHA-256 hash is stored (`sessions.tokenHash`), so a database read does not yield usable
  tokens. Sessions are revocable (logout, password change/reset, role change, suspension).
  Bearer tokens are accepted for future native clients.
- **Same origin:** browsers call `/api/*` on the web origin; a Next.js route handler proxies to the
  API. CORS is disabled on the API.
- **CSRF:** every state-changing request must carry `x-kdcn-csrf: 1`. Browsers cannot add custom
  headers cross-origin without a CORS preflight, which the API rejects. Provider webhooks are
  exempt (`@SkipCsrf`) and authenticated by HMAC signature instead.
- **Deny by default:** the global `AuthGuard` requires a session unless a route is `@Public()`.
- **Staff MFA:** staff routes (`@Staff(...)`) require an MFA-verified session (TOTP, RFC 6238).
- **Passwords:** scrypt (N=2¹⁷, r=8, p=1), parameters stored with each hash; lockout after 5
  failures for 15 minutes; constant-time handling of unknown emails.
