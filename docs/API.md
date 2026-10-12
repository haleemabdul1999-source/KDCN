# API reference

- Base path: `/api` (browsers reach it same-origin via the web app's proxy; services may call the
  API directly).
- **Full route list with access rules:** [API-ROUTES.md](API-ROUTES.md) (generated from code:
  `pnpm --filter @kdcn/api build && pnpm --filter @kdcn/api docs:api`).

## Conventions

| Topic         | Rule                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth          | Session cookie `kdcn_session` (HttpOnly) set by `POST /auth/login` / `register`; or `Authorization: Bearer <token>`. Deny-by-default; `401` when a session is required.                                                                                                                                |
| Staff         | Requires a staff role **and** MFA: after login call `POST /auth/mfa/verify {code}` (or `/auth/mfa/setup` first). Otherwise `403 {code:"MFA_REQUIRED"}`.                                                                                                                                                |
| CSRF          | All non-GET requests must send `x-kdcn-csrf: 1` → otherwise `403`. Webhooks exempt.                                                                                                                                                                                                                    |
| Validation    | JSON bodies validated with zod; `400 {message:"Validation failed", errors:[{path,message}]}`.                                                                                                                                                                                                          |
| Money         | Integer kobo everywhere (`…Minor`). ₦1 = 100.                                                                                                                                                                                                                                                          |
| Errors        | `{statusCode, requestId, message, code?}`. Codes include `INVALID_TRANSITION`, `STALE_ORDER`, `OUT_OF_STOCK`, `NOT_PAYABLE`, `ALREADY_PAID`, `PAYMENT_WINDOW_CLOSED`, `REFUND_EXCEEDS_BALANCE`, `PAYMENT_IN_PROGRESS`, `DUPLICATE`. 5xx bodies never include internals; correlate with `X-Request-Id`. |
| Idempotency   | `POST /checkout/place` requires `Idempotency-Key` (16–80 chars `[A-Za-z0-9_-]`). Same key + same body → same order (`replayed: true`); same key + different body → `409`. Staff refunds take an `idempotencyKey` field.                                                                                |
| Pagination    | `?page=1&pageSize=20` (max 50, search max 48) → `{items,total,page,pageSize}`.                                                                                                                                                                                                                         |
| Rate limits   | Global per-IP limit (`RATE_LIMIT_PER_MINUTE`), stricter on auth (`AUTH_RATE_LIMIT_PER_MINUTE`) and checkout (`CHECKOUT_RATE_LIMIT_PER_MINUTE`) → `429`.                                                                                                                                                |
| Object access | Merchant routes are `/merchant/:merchantId/...`; non-members get `404`. Every object is additionally scoped by `merchantId`.                                                                                                                                                                           |
| Guest orders  | Order endpoints accept `x-kdcn-order-token: <guestAccessToken>` returned once by checkout.                                                                                                                                                                                                             |

## Core flows (examples)

### Register / login

```http
POST /api/auth/register      {"name":"Halima Yusuf","email":"h@x.ng","phone":"08030000001","password":"Password1234"}
POST /api/auth/login         {"email":"h@x.ng","password":"Password1234"}
→ 200 {"user":{…},"mfaRequired":false,"mfaEnrolmentRequired":false}
```

### Search

```http
GET /api/search?q=ankara&market=galaxy-mall&availability=in_stock&fulfilment=collection&verified=true&minPrice=500000&sort=price_asc&page=1
→ {"items":[{"id","slug","title","priceFromMinor","availability":{"code","label","purchasable"},"merchant":{…,"identityVerified"},…}],"total":…}
```

Filters: `q, category, merchant, market, city, area, minPrice, maxPrice (kobo), availability (any|in_stock|made_to_order|confirm_on_order), fulfilment (any|delivery|collection), verified, merchantType, sort (relevance|price_asc|price_desc|newest)`.

### Cart → checkout → pay

```http
POST /api/cart/items                    {"listingVariantId":"…","quantity":2}
POST /api/checkout/quote                {"merchantId":"…"}                     → options & delivery areas
POST /api/checkout/quote                {"merchantId":"…","fulfilmentMethod":"MERCHANT_DELIVERY","deliveryAreaId":"…"} → totals & terms
POST /api/checkout/place  (Idempotency-Key: …)
  {"merchantId":"…","fulfilmentMethod":"MERCHANT_DELIVERY","deliveryAreaId":"…","deliveryAddress":"…","recipientPhone":"…","acceptTerms":true}
→ 201 {"order":{"id","number","status":"PENDING_MERCHANT_CONFIRMATION"|"AWAITING_PAYMENT",…,"actions":{…}},"guestAccessToken"?}
POST /api/orders/:id/pay                → {"reference","authorizationUrl","provider","testMode"}
POST /api/orders/:id/verify-payment     {"reference":"…"} → {"outcome":"paid"|"pending"|"failed"|…,"order":{…}}
```

### Merchant order actions

`POST /api/merchant/:merchantId/orders/:orderId/{confirm|reject|accept|preparing|ready|dispatch|delivered|collected|delivery-failed|cancel}`
(bodies: `reject {reason}`, `dispatch {partnerName, riderName?, riderPhone?}`, `collected {code}`, `delivery-failed {note}`, `cancel {reason}`).

### Webhooks

`POST /api/payments/webhooks/{paystack|mock}` — raw JSON body, signature header
(`x-paystack-signature` / `x-mock-signature`, HMAC-SHA512 hex). Responses: `200` recorded
(including duplicates and ignored events), `401` bad signature, `500` processing failed (provider
should retry).

### Health

`GET /api/health` (liveness) · `GET /api/health/ready` (DB reachable, migrations applied; reports
payment provider and whether it is in test mode).
