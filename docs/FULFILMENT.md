# Fulfilment

| Method                 | Who                                                                                                       | Fee source                                           | Completion                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `IN_STORE_COLLECTION`  | Customer collects from a public store (not available to home vendors)                                     | free                                                 | Merchant enters the customer's 6-digit code → COMPLETED      |
| `COLLECTION_POINT`     | Shared/neutral pickup point (Galaxy Mall desk restricted to affiliated merchants)                         | option fee                                           | Code verified at handover                                    |
| `MERCHANT_DELIVERY`    | Merchant's own rider                                                                                      | per-area fee from service areas (paid to merchant)   | Merchant marks delivered → customer confirms / auto-complete |
| `THIRD_PARTY_DELIVERY` | KDCN-arranged courier (manual dispatch in R1); `pickupFromMerchant` = scheduled pickup from a home vendor | area fee or flat option fee (retained for logistics) | Ops/merchant marks delivered                                 |

- **Collection codes**: issued at payment, stored encrypted, shown to the customer only after
  payment. Failed code entries are recorded outside the business transaction; after 5 failures
  handover requires KDCN support (anti brute-force).
- **Failed delivery**: DISPATCHED → PREPARING with a `FAILED_ATTEMPT` event and customer
  notification; after 3 attempts the merchant/staff should cancel with refund.
- **Dispatch**: `DeliveryAssignment` records partner, rider, phone; the courier receives the
  pickup address (private addresses decrypted only here) and the customer's delivery address.
- **Logistics costs**: ops record the actual courier cost (`logisticsCostMinor`); missing costs
  make contribution margin "incomplete" rather than assumed zero.
- **Tracking**: no live tracking is promised (`liveTracking: false`). A courier integration
  implements `LogisticsAdapter` (`fulfilment/logistics.adapter.ts`).
