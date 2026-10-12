# ADR 0007 — Privacy by design for home-based vendors

**Status:** accepted

- Locations are typed: `PUBLIC_STORE` (public address) or `PRIVATE_FULFILMENT` (AES-256-GCM
  encrypted, never selected by public queries). A DB `CHECK` prevents a location from holding both.
- Public merchant data is returned only through `PUBLIC_MERCHANT_SELECT` (an allow-list).
- Storefronts show a general area label ("Barnawa, Kaduna"), never a street address.
- Home vendors cannot enable in-store collection; buyers use delivery or neutral pickup points.
- Uploaded photos have EXIF/XMP (incl. GPS) stripped before storage.
- Private addresses are visible to the merchant's own members, to staff (audited), and to the
  courier via dispatch. Customer addresses are revealed to merchants only after payment.
- Tests assert that public endpoints never contain the private address (Scenario B).
