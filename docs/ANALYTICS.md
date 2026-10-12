# Analytics definitions

Computed in `apps/api/src/modules/analytics/analytics.service.ts`; shown in Admin → Overview (by
segment), the merchant dashboard (own store) and the market-operator portal (aggregate only).
Period = `[from, to)` (default last 30 days). Money in kobo.

## Segments

Each order stores a segment snapshot at checkout: `GALAXY_MALL` (approved Galaxy Mall affiliation),
`OTHER_MARKET` (other approved market), `HOME_VENDOR`, `INDEPENDENT`. Merchant counts use the
merchant's _current_ segment.

## Metrics

| Metric                                                  | Definition                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders initiated                                        | Orders created in the period (excludes internal DRAFT)                                                                                                                                                              |
| Paid orders                                             | Orders whose **verified** payment landed in the period (`paidAt`)                                                                                                                                                   |
| Orders completed / cancelled                            | Orders reaching COMPLETED / CANCELLED in the period                                                                                                                                                                 |
| Order → payment conversion                              | Paid orders ÷ orders initiated (same period; approximation — cohorts may straddle periods)                                                                                                                          |
| Failed payment attempts                                 | Payment attempts verified FAILED in the period                                                                                                                                                                      |
| **GMV**                                                 | Σ goods subtotal of paid orders (excludes delivery and service fees; **before** refunds)                                                                                                                            |
| **Platform revenue**                                    | Σ (commission + customer service fee) of paid orders, excluding fully refunded orders                                                                                                                               |
| Delivery fees retained                                  | Delivery fees on paid orders not delivered by the merchant (pass-through to logistics; not revenue)                                                                                                                 |
| Refunds                                                 | Σ successful refunds completed in the period (excludes refunds of duplicate payments)                                                                                                                               |
| Provider fees                                           | Σ payment provider fees on payments succeeding in the period                                                                                                                                                        |
| Logistics costs                                         | Σ recorded courier costs for KDCN-arranged deliveries paid in the period                                                                                                                                            |
| **Contribution margin**                                 | Revenue + delivery fees retained − provider fees − logistics costs. **Marked incomplete** (with reasons) when any provider fee or KDCN-arranged logistics cost is unknown — unknown costs are never treated as zero |
| Transacting merchants                                   | Distinct merchants with ≥1 paid order in the period                                                                                                                                                                 |
| Merchant retention                                      | Merchants transacting in both the previous equal-length period and this one ÷ merchants transacting in the previous period                                                                                          |
| Repeat purchase rate                                    | Customers (registered) with ≥2 lifetime paid orders ÷ customers with ≥1 paid order in the period                                                                                                                    |
| Product views / storefront views                        | First-party events (`PRODUCT_VIEW`, `STOREFRONT_VIEW`)                                                                                                                                                              |
| Search-to-product rate                                  | `SEARCH_RESULT_CLICK` ÷ `SEARCH` events (platform-wide)                                                                                                                                                             |
| Avg hours paid → delivered                              | Mean of (fulfilment completed − paid) for orders delivered/collected in the period                                                                                                                                  |
| Failed delivery attempts, disputes opened               | Counts for orders in the period                                                                                                                                                                                     |
| Registered / submitted / approved / suspended merchants | Current counts by segment                                                                                                                                                                                           |
| Registered customers                                    | Customer profiles                                                                                                                                                                                                   |

## Caveats

- Behavioural events are first-party, cookie-less (daily salted hash of IP+UA, IP not stored) and
  can be inflated by automated traffic despite rate limits; treat as directional.
- Revenue excludes VAT treatment — finance must confirm tax handling.
- Contribution margin excludes fixed costs (staff, hosting, marketing) by definition.
