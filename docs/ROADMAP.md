# Roadmap

## Release 1.1 — go-live readiness (before real money)

1. Paystack sandbox activation checklist; then live keys under business sign-off.
2. Settlement model decision; provision subaccounts for pilot merchants if `PROVIDER_SPLIT`.
3. Email + SMS delivery adapters (transactional email provider; Termii or similar for SMS).
4. Error monitoring, uptime alerts, log aggregation; build & scan container images in CI.
5. S3-compatible storage driver, upload malware scanning, image resizing.
6. Legal content: terms, privacy notice, seller agreement, refund policy; NDPA compliance tasks.
7. Accessibility audit (axe in CI + manual), performance budget checks in CI.
8. Dispute evidence uploads; finance CSV exports.

## Release 2 — marketplace operations

- Verified-purchase reviews: photo reviews, helpfulness, response SLAs (basic reviews already in R1).
- Courier integrations behind `LogisticsAdapter` (pickup booking, status webhooks, live tracking where supported).
- Advanced inventory: low-stock alerts, bulk stock updates, CSV product import.
- Merchant promotions and discount codes (clearly labelled; sponsored placements separate from organic ranking).
- Automated settlement reconciliation against provider settlement reports.
- Enhanced analytics: cohorts, funnels, merchant scorecards, exports.
- More collection arrangements: collection-desk operator app, scheduled pickups.
- WhatsApp Business notifications.

## Release 3 — scale & ecosystem

- Multi-merchant basket checkout with split fulfilment & settlement (data model already supports it).
- Wholesale purchasing, quotation requests and negotiation for market traders.
- Additional branded market experiences (operator self-service onboarding).
- Merchant software integrations (POS/inventory sync, public API with OAuth).
- Financial-service partnerships (only with licensed partners).
- National expansion: multi-city geography, localisation (Hausa, Yoruba, Igbo), region-aware delivery.
