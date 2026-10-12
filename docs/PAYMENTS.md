# Payments, refunds and settlement

## Principles

1. **Verification first.** `PAID` only after the provider's server-side verify API confirms success
   for our reference, the exact amount and currency (`PaymentsService.applyVerification`).
2. **Idempotent everything.** Unique payment references; unique `(provider, eventKey)` webhook
   events; row locks + status re-check before applying; unique partial index allows only one
   non-duplicate `SUCCEEDED` payment per order; refund idempotency keys.
3. **Never keep money silently.** A success for an already-paid or cancelled order is recorded
   (`isDuplicate = true`) and refunded automatically.
4. **Provider-agnostic.** Orders depend only on `PaymentProviderAdapter`.

## Flow

1. `POST /orders/:id/pay` — re-verifies any open attempt first (prevents double charging), creates a
   `payment_transactions` row (`INITIATED`), calls `initialize`, stores the authorization URL, moves
   the order to `PAYMENT_PENDING_VERIFICATION`, returns the URL. Provider outage → `503`, the order
   stays payable.
2. Customer pays on the provider's page.
3. Provider → `POST /api/payments/webhooks/:provider` (HMAC verified, stored, then `verify()`), and
   redirects the customer to `/orders/:id/payment-return?reference=…`, which calls
   `POST /orders/:id/verify-payment` (the same idempotent verification).
4. Failed/abandoned → order returns to `AWAITING_PAYMENT`; customer may retry.
5. Payment window expiry job re-verifies before cancelling.

## Refunds

- Raised by: customer cancellation of a `PAID` order, merchant/staff cancellation before delivery,
  dispute resolution (full/partial), staff goodwill refund (requires FINANCE approval), automatic
  duplicate/late-payment refunds.
- Balance check under order row lock: Σ(active refunds) + new ≤ payment amount.
- `APPROVED → PROCESSING → SUCCEEDED | FAILED`. Provider outage returns the refund to `APPROVED`
  and the `refunds.process` job retries. Pending provider refunds complete via `refund.*`
  webhooks (re-fetched from the provider) or reconciliation after 10 minutes.
- Full refund → order `REFUNDED`, settlement `REVERSED`. Partial → merchant net reduced.

## Settlement allocations

Per paid order: `gross` (goods), `commission` (rule snapshot at checkout), `serviceFee`,
`deliveryFee`, `merchantDelivery` (merchant-delivered only), `providerFee`, `refunded`,
`merchantNet = gross − commission + merchantDelivery − refunds`.
Status: `PENDING_FULFILMENT → ELIGIBLE (completed) → SETTLED (payout recorded)`, `ON_HOLD` during
disputes, `REVERSED` on full refund.

### Settlement mode — business/legal decision required

- `PROVIDER_SPLIT`: initialize with the merchant's subaccount and `transaction_charge` = KDCN's
  share (commission + service fee + non-merchant delivery fee). The provider pays the merchant.
  **Recommended.** Refund handling with split payments must be confirmed with the provider
  (who bears the refund, how fees are reversed).
- `MANUAL_RECORD` (seed default for demo): money settles to KDCN; finance pays merchants and
  records references. **Possibly a regulated activity; obtain legal and provider confirmation.**
- KDCN does **not** implement escrow, delayed release or wallets. Split settlement is not escrow.

## Commission

Rules: `MERCHANT` > `MARKET` (approved affiliation) > `MERCHANT_TYPE` > `DEFAULT` (> fallback 5%).
`rateBps` applies to goods subtotal; `serviceFeeMinor` is a flat customer fee. Rules are snapshotted
on each order; changes apply only to new orders and are audited.

## Mock provider (development and tests only)

`PAYMENT_PROVIDER=mock`. Charges stored in `mock_provider_charges`; `/pay/mock/:reference` is a
TEST MODE page; webhooks are HMAC-SHA512-signed with `MOCK_PAYMENT_WEBHOOK_SECRET`; deterministic
fee 1.5% capped at ₦2,000; `MockPaymentProvider.unavailable` simulates outages. Mock payments are
flagged `isTestMode` and labelled "TEST" in every UI. Env validation refuses `mock` in production.

## Paystack activation checklist (not yet performed)

The adapter (`providers/paystack.provider.ts`) follows Paystack's documented API
(`/transaction/initialize`, `/transaction/verify/:reference`, `/refund`, `/refund/:id`,
`x-paystack-signature` HMAC-SHA512). It is covered by contract tests against a stubbed `fetch`
only. Before go-live, with **test keys**:

- [ ] Re-read current Paystack docs; confirm request/response fields used by the adapter.
- [ ] `PAYMENT_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY=sk_test_…`, configure the webhook URL
      `https://<web-domain>/api/payments/webhooks/paystack` in the Paystack dashboard.
- [ ] Card success, card decline, abandoned checkout, bank transfer/USSD (async) success.
- [ ] Duplicate webhook delivery (resend from dashboard) → single `PAID`.
- [ ] Full and partial refunds; `refund.processed` webhook; refund failure path.
- [ ] Verify `fees` are populated (contribution margin).
- [ ] Subaccount split: create a subaccount, set merchant `PROVIDER_SPLIT`, confirm settlement and
      refund behaviour.
- [ ] Restrict webhook source IPs at the edge if Paystack publishes them; keep signature checks.
- [ ] Switch to live keys only with business sign-off.
