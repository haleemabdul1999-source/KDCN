# ADR 0002 — Separate product identity from merchant listings

**Status:** accepted

`Product` (title, description, category, attributes, images, variants) is separate from `Listing`
(a merchant's offer: price per variant via `ListingVariant`, stock mode, lead time, min/max quantity,
return policy, status). In Release 1 every product is created by the selling merchant, but the
model allows several merchants to list the same product later (catalogue matching, price
comparison) without migrating orders, which reference `ListingVariant` and snapshot titles/prices.

Stock modes make availability honest:

- `TRACKED` — merchant keeps a count; stock is reserved at checkout with a conditional `UPDATE`.
- `CONFIRM_ON_ORDER` — no reliable count; merchant confirms before the customer can pay.
- `MADE_TO_ORDER` — produced after order; confirmation + lead time.
