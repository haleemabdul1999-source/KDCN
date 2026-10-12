# MVP acceptance report — Release 1

**Date:** 2026-10-12 · **Branch:** `claude/kdcn-commerce-platform-409kan`
**Environment:** Linux container, Node 22.22, PostgreSQL 16.15, Chromium (Playwright).
**Payment provider for all evidence below: the deterministic MOCK provider (test mode — no money
moved).** Paystack has not been exercised against its sandbox (see §6).

## 1. Summary

| Acceptance scenario                                                                                                             | Result                  | Evidence                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| A — Galaxy Mall retailer: register → approval → products → Galaxy search → order → confirm → verified test payment → collection | ✅ Pass                 | `apps/api/test/integration/scenario-a-galaxy-mall.spec.ts`; e2e `merchant-admin.spec.ts` (UI, mobile + desktop) |
| B — Home vendor: verification → storefront without residential address → order → delivery coordination                          | ✅ Pass                 | `scenario-b-home-vendor.spec.ts`; e2e "home vendor storefront never shows…"                                     |
| C — Cross-segment discovery from one search                                                                                     | ✅ Pass                 | `scenario-c-discovery.spec.ts`; e2e customer journey                                                            |
| D — Merchant isolation (products, orders, settlements, customers)                                                               | ✅ Pass                 | `scenario-d-isolation.spec.ts`                                                                                  |
| E — Payment reliability (duplicate webhooks, unrelated orders, failed payments)                                                 | ✅ Pass (mock provider) | `scenario-e-payments.spec.ts`; e2e declined-payment test                                                        |
| F — Administrative governance with audit logs                                                                                   | ✅ Pass                 | `scenario-f-governance.spec.ts`; e2e admin MFA test                                                             |
| G — Segment reporting (paid volume, GMV, revenue, indicators)                                                                   | ✅ Pass                 | `scenario-g-reporting.spec.ts`; admin overview screenshot                                                       |
| H — Failure handling (confirmation failure, provider outage, delivery failure, cancellation)                                    | ✅ Pass (mock provider) | `scenario-h-failures.spec.ts`                                                                                   |

**Final verification run (all on the final commit):**

| Suite                                                    | Command                                                           | Result                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| API lint                                                 | `pnpm --filter @kdcn/api lint`                                    | 0 problems                                  |
| API typecheck (src + tests)                              | `pnpm --filter @kdcn/api typecheck`                               | clean                                       |
| Web typecheck                                            | `pnpm --filter @kdcn/web typecheck`                               | clean                                       |
| Schema ↔ migrations drift                               | `prisma migrate diff --from-migrations … --to-schema-datamodel …` | "No difference detected"                    |
| API unit + integration                                   | `pnpm --filter @kdcn/api test`                                    | **14 suites, 77 tests passed**              |
| Web production build                                     | `pnpm --filter @kdcn/web build`                                   | success; first-load JS 102–113 kB per route |
| End-to-end (Playwright, real API + production web build) | `pnpm --filter @kdcn/web test:e2e`                                | **10 passed** (mobile Pixel 7 + desktop)    |
| Performance budget                                       | `node apps/web/scripts/perf-budget.mjs`                           | all pages within budget (§4)                |

## 2. Scenario evidence (what the tests actually assert)

### A — Galaxy Mall retailer

Owner registers through the API; creates a `MALL_RETAILER` merchant; sets payout account (encrypted);
adds a Galaxy Mall shop location; requests affiliation; **Galaxy operator approves** it; enables
in-store collection and the Galaxy collection desk; uploads the documents the pathway demands
(`MARKET_RETAILER`: ID + tenancy); submits; **staff approve with MFA session**. Listing (confirm-on-order)
appears in `/search?q=loafers&market=galaxy-mall` and on `/markets/galaxy-mall`. Customer orders →
`PENDING_MERCHANT_CONFIRMATION`; paying is refused (409) until the merchant confirms; customer phone
is hidden from the merchant until payment. Mock payment verified → `PAID`; settlement allocation
`gross 2,500,000 / commission 112,500 (Galaxy 4.5% rule) / net 2,387,500` kobo. Accept → preparing →
ready; wrong collection code rejected; correct code → `COMPLETED`; settlement `ELIGIBLE`; finance
records payout `TRF-0001` → `SETTLED`, visible to the merchant. The full 10-step event history is
asserted. Also: non-Galaxy merchants cannot use the Galaxy collection desk (403).

### B — Home vendor

Private fulfilment address stored as `enc:v1:…` (ciphertext asserted). Home vendors cannot enable
in-store collection (400). Food listing held for moderation (`PENDING_REVIEW`, 404 publicly) until
staff approve; prohibited category (medicines) refused. Uploaded JPEG's EXIF GPS removed on disk.
Storefront, product, search and home responses **never contain the address, `privateAddress` or
payout data**; public label is "Barnawa, Kaduna". Order with merchant delivery to Narayi (₦1,000
area fee); delivery to an unserved area refused. After payment the merchant sees the delivery address
and phone; dispatch with rider details visible to the customer (`liveTracking: false`); delivered →
customer confirms → `COMPLETED`. Verified-purchase review; merchant may respond once (second → 409);
duplicate review → 409.

### C — Discovery

One query returns mall, home-vendor and independent offerings; unapproved merchant excluded;
out-of-stock ranked last; typo (`ankra`) and prefix (`ank`) tolerated; filters by market, merchant
type, category (incl. children), price range, availability mode, delivery/collection, verification,
area; price sorting; pagination; malformed input → 400; SQL-looking input harmless.

### D — Isolation

Merchant B calling 11 private endpoints under merchant A's ID → all 404. Substituting A's listing /
order / variant IDs under B's own merchant ID → 404 (read, update, inventory, accept, cancel); B's
lists contain nothing of A's; database unchanged. Customers can't read or cancel others' orders;
anonymous access needs the guest token. Staff roles separated (SUPPORT can't read settlements or
suspend merchants); operators see no payout/contact/private/customer fields, editors can't approve,
other markets → 404. Missing CSRF header → 403.

### E — Payments

Webhook delivered 3× → results `paid, duplicate_ignored, duplicate_ignored`; one event row with
`deliveryCount 3`; exactly one SUCCEEDED payment, one settlement, one PAID event. Six concurrent
verifications → exactly one `paid`. Bad signature → 401, nothing stored. Forged reference →
`unknown_reference`; a "success" webhook for a charge that hasn't succeeded → `pending`, order unpaid.
Redirect alone → still `PAYMENT_PENDING_VERIFICATION`. Failed payment → `AWAITING_PAYMENT`, no
settlement; retry succeeds. Second successful payment → `isDuplicate`, automatic refund, still one
settlement. Amount mismatch → not paid, audited.

### F — Governance

Staff without MFA → 403 `MFA_REQUIRED`; enrolment returns an `otpauth://` URI; bad code → 401.
Merchant review: private address visible to staff with an audit record; verification document
decrypted and served with an audit record; owners can't use the admin route. Request-info with
enhanced tier → pathway becomes ENHANCED, submission blocked until proof of address uploaded →
approve (validity ≈ 1 year) → suspend hides listings from search and product page → reinstate; all
audited. Dispute: opened (settlement ON_HOLD), second dispute refused, merchant responds, assigned,
resolved with partial refund → order COMPLETED, settlement net reduced, re-resolution refused, single
refund. Goodwill refund: idempotent, over-refund refused, SUPPORT can't approve, FINANCE approves.
**`UPDATE`/`DELETE` on `audit_events` rejected by the database.** Commission change audited and not
applied retroactively.

### G — Reporting

Seeded activity: Galaxy (2 paid of 3), home vendor (1 paid qty 3, 1 failed), independent (1 paid then
fully refunded). Asserted per segment: orders initiated, paid orders, GMV (2,000,000 / 600,000 /
500,000 kobo), platform revenue (Galaxy 2×(45,000+10,000); home 24,000+10,000; independent 0 after full
refund), refunds 510,000, failed payments, conversion, active merchants, search-to-product rate, merchant
counts by segment; contribution margin consistent with its definition and **flagged incomplete when
provider fees are unknown**. Operator portal shows only Galaxy aggregates.

### H — Failure handling

Two customers race for the last unit → exactly one order (other `OUT_OF_STOCK`); cancellation releases
the reservation. Idempotent checkout replay returns the same order; key reuse with a different body → 409. Merchant declines → cancelled, no payment rows. Confirmation timeout job cancels. **Provider outage**
→ 503, order stays payable; succeeds after recovery; post-payment cancellation → full refund,
`REFUNDED`, settlement `REVERSED`, second cancel refused, one refund. Payment window expiry cancels and
releases stock; a late success is auto-refunded by the job. Three failed deliveries tracked, then
cancellation with refund. Refund-provider outage → refund queued (APPROVED) and completed by the job.
Invalid transitions → 409; concurrent double-confirm → one 200, one 409, one event. Guest checkout +
token tracking.

### Additional coverage

`auth-account.spec.ts`: lockout, password reset (single-use, revokes sessions), account deletion with
anonymisation and retained financial records, retention job. Unit tests: state machine graph
properties, money rounding, RFC 6238 TOTP vectors, scrypt, AES-GCM tamper detection, upload sniffing &
EXIF/PNG metadata stripping, availability messaging, tsquery sanitising, segments, env validation,
Paystack adapter contract (stubbed HTTP).

## 3. End-to-end browser tests (production build, real API, mock payments)

1. Mobile: home → hero search → results from mall + independent sellers → product page with
   identity-verification disclaimer → sign in → add to cart → checkout (collect in store, terms) →
   pay on TEST MODE page → server-side verification page → order shows Paid and a 6-digit collection
   code; search click attributed for analytics.
2. Mobile: declined test payment → "not completed" → order still payable.
3. Mobile: home-vendor storefront HTML contains no private address; no horizontal scroll.
4. Mobile: Galaxy Mall landing → mall-scoped search excludes non-mall sellers.
5. Mobile & desktop: merchant confirms a customer's confirm-on-order item → customer pays → merchant
   accepts, prepares, marks ready, verifies the collection code → earnings shown.
6. Mobile & desktop: admin password + TOTP → segment table → audit log shows `payment.succeeded`.
7. Mobile & desktop: customer blocked from admin.

## 4. Performance (emulated constrained mobile)

`apps/web/scripts/perf-budget.mjs`: Pixel 7 viewport, 1.6 Mbps down / 750 Kbps up / 150 ms RTT,
4× CPU slowdown, cold cache. Budget: FCP ≤ 2.5 s, load ≤ 4 s, JS ≤ 150 KB, total ≤ 500 KB transferred.

| Page                   | FCP    | Load    | JS     | Total  |
| ---------------------- | ------ | ------- | ------ | ------ |
| `/`                    | 504 ms | 1114 ms | 122 KB | 156 KB |
| `/search?q=ankara`     | 468 ms | 1151 ms | 119 KB | 148 KB |
| `/p/zainab-fabrics-1`  | 460 ms | 1170 ms | 119 KB | 145 KB |
| `/s/amina-bakes`       | 472 ms | 1153 ms | 123 KB | 150 KB |
| `/markets/galaxy-mall` | 472 ms | 1141 ms | 122 KB | 149 KB |

Caveats: servers on the same host (no real server/network distance); demo data has **no product
photos**, so image weight is not represented — real catalogues need resized images/CDN
(KNOWN_LIMITATIONS #6, #17).

## 5. Screenshots

`docs/screenshots/`: mobile home, search, product, home-vendor storefront, Galaxy Mall; merchant
overview, orders, payouts, new product; admin overview (segment reporting); operator portal.

## 6. Not verified / outstanding (must be read with this report)

- **Paystack**: adapter not run against the sandbox; settlement model needs legal/provider confirmation.
- **Notifications**: log driver only — no real email/SMS delivery.
- **Containers/deployment**: Dockerfiles and compose not built (no Docker daemon); no deployment made.
- **Monitoring**: no error-tracking SDK wired.
- **Accessibility**: no formal audit; **legal content** absent.
- Full list: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## 7. Defects found and fixed during verification

| Defect                                                                                        | Fix                                                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Next.js `rewrites()` baked the API URL in at build time (proxy hit the wrong port at runtime) | Runtime route-handler proxy `src/app/api/[...path]/route.ts`                                                   |
| Admin overview refetched analytics in a loop (timestamp recomputed every render)              | `useMemo` on the period                                                                                        |
| Search-to-product attribution never fired on client-side navigation                           | Session flag instead of `document.referrer`; e2e assertion added                                               |
| Typo tolerance missed "ankra" (whole-title trigram similarity)                                | `word_similarity`                                                                                              |
| Checkout rate limit not configurable (blocked tests; ops need control)                        | `CHECKOUT_RATE_LIMIT_PER_MINUTE`                                                                               |
| Intermittent test failure under concurrent HTTP requests                                      | Root-caused to supertest closing its per-request listener (reproduced 14/40 vs 0/40); harness now listens once |
| Finance UI initially implied KDCN never holds funds — untrue under manual payouts             | Wording corrected; legal decision flagged                                                                      |
| Prisma CLI refuses `migrate reset` when invoked by an AI agent                                | Not bypassed; e2e uses non-destructive `migrate deploy` on an empty DB                                         |
