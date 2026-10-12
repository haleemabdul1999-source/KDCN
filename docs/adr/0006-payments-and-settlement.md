# ADR 0006 — Payment provider abstraction, verification-first, settlement records (not escrow)

**Status:** accepted (settlement model pending business/legal decision)

- Orders depend on `PaymentProviderAdapter` only. Implementations: deterministic `MockPaymentProvider`
  (dev/test, refused in production by env validation) and `PaystackProvider`.
- An order is marked paid **only** after the provider's server-side verification confirms success
  for our reference, amount and currency. Redirects and webhook bodies never mark orders paid.
- Webhooks are persisted first with a unique `(provider, eventKey)`; redeliveries are acknowledged
  without reprocessing.
- `settlement_allocations` record each paid order's split (gross, commission, fees, merchant net,
  refunds) and payout status. **They are records of entitlement, not escrow.** KDCN does not
  implement delayed release, custodial wallets or other regulated financial services.
- Two settlement modes:
  - `PROVIDER_SPLIT` — provider settles the merchant's share directly (e.g. Paystack subaccounts);
    KDCN receives only its commission/fees. Recommended default once subaccounts are provisioned.
  - `MANUAL_RECORD` — funds settle to KDCN's provider account and finance pays merchants,
    recording transfer references. **This may constitute collecting funds on behalf of merchants
    and must be cleared with counsel and the provider before live use.**
