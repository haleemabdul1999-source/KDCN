# ADR 0004 — Money as integer kobo

**Status:** accepted

All authoritative amounts are integers in minor units (kobo) stored in PostgreSQL `integer`
columns. Commission uses integer basis-point arithmetic with half-up rounding (`applyBps`). No
floating-point arithmetic touches stored amounts; the UI converts naira input with `Math.round(x*100)`.

`integer` caps a single amount at ₦21.47m; checkout rejects totals above ₦20m. Wholesale (Release 3)
may need larger orders: migrate the money columns to `bigint` and serialise as strings in JSON at
that point. Aggregates are computed in SQL as `bigint` and converted for display.

Database `CHECK` constraints enforce `total = subtotal + delivery + service`, line totals,
non-negative amounts, `reserved ≤ quantity` for inventory and refund bounds.
