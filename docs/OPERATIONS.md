# Operations: monitoring, runbooks, backup & recovery

## Health & monitoring

| Signal            | Source                                                                                                     | Alert when                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Liveness          | `GET /api/health`                                                                                          | non-200 for 2 min                 |
| Readiness         | `GET /api/health/ready` (DB + migrations)                                                                  | non-200 for 2 min                 |
| Error rate        | JSON logs `level=error` (`request.failed` includes `requestId`)                                            | > 1% of requests / 5 min          |
| Webhook failures  | logs `webhook.processing_failed`, `webhook.invalid_signature`; Admin → Finance → Webhook log (unprocessed) | any unprocessed > 15 min          |
| Amount mismatches | log `payment.amount_mismatch`, audit `payment.amount_mismatch`                                             | any                               |
| Refund failures   | Admin overview "failed refunds"; audit `refund.failed`                                                     | any                               |
| Job health        | logs `job.failed`; Admin → Platform → Background jobs                                                      | repeated failures                 |
| Orders stuck      | `PAYMENT_PENDING_VERIFICATION` > 1 h; `PENDING_MERCHANT_CONFIRMATION` near deadline                        | count > 0 (ops follow-up)         |
| Courier queue     | Admin overview "Courier deliveries to arrange"                                                             | > 0 for 2 h during business hours |

Logs are one JSON object per line (`ts, level, context, msg, …`) — ship stdout/stderr to the log
platform. They contain no passwords, tokens, card data, addresses or document contents;
notification recipients are masked.

**Error monitoring:** add an error-tracking SDK in `bootstrap.ts` (API) and an `instrumentation.ts`
(web). Not wired in Release 1 (KNOWN_LIMITATIONS).

## Runbooks

### A customer says they paid but the order shows unpaid

1. Admin → Orders → find the order → Payments table.
2. Click **Re-verify** (calls the provider's verify API). If the provider says success, the order
   becomes PAID (idempotent).
3. If the provider has no record, ask for the bank reference and check the provider dashboard.
4. If paid after the order was cancelled, the system raises an automatic refund — check Finance → Refunds.

### Webhooks are failing

1. Admin → Finance → Webhook log: look at `result`.
2. `invalid_signature` → check `PAYSTACK_SECRET_KEY` matches the dashboard environment (test vs live).
3. `processing_failed` → see logs by time; the provider retries; you can also Re-verify affected payments.

### Refund failed

Finance → Refunds → **Retry**. If it fails again, contact the provider with the payment reference;
record the outcome in the dispute/order notes.

### Merchant can't confirm in time / is unreachable

Orders auto-cancel at the confirmation deadline (customer not charged). For paid orders, ops can
cancel with full refund from Admin → Orders.

### Delivery failed repeatedly

Admin → Fulfilment → record attempts. After 3 attempts cancel the order with refund (merchant or
staff), and contact the customer.

### Suspected fraudulent merchant

Admin → Merchants → **Suspend** (listings disappear from search immediately). Open disputes stay
with support; review audit log for the merchant (`/admin/audit?entityId=…`).

### Lost staff MFA device

A super-admin removes and re-adds the user's staff roles (revokes sessions); the user signs in and
enrols a new authenticator. (A dedicated MFA reset action is on the roadmap.)

## Backup & recovery

- **Database:** managed automated backups + PITR (≥ 7 days; 30 recommended). Quarterly restore
  drill: restore to a new instance, run `prisma migrate status`, run the API against it read-only,
  verify order/payment counts.
- **Object storage:** enable versioning + daily backup of the storage volume/bucket. Private
  documents are encrypted with `DATA_ENCRYPTION_KEY` — **back up the key separately** in the
  secret manager; without it, encrypted fields and documents are unrecoverable.
- **RPO/RTO targets (proposed):** RPO ≤ 15 min (PITR), RTO ≤ 4 h.
- **Payments reconciliation after restore:** after any restore, re-verify payments created after
  the restore point from the provider's dashboard/API (Admin → Payments → Re-verify).

## Routine tasks

- Daily: refunds awaiting approval, failed refunds, courier queue, open disputes, merchants to review.
- Weekly: payouts due (Finance → Payouts due), record transfer references.
- Monthly: verification expiries (job marks them EXPIRED; follow up with merchants), commission review,
  access review of staff roles and market operators.
