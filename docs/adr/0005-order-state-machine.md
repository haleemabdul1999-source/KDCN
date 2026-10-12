# ADR 0005 — Explicit order state machine with compare-and-set transitions

**Status:** accepted

The permitted transitions are a single table (`order-state-machine.ts`). Every change goes through
`OrderStateService.transition`, which (1) validates the move, (2) updates with
`WHERE id = ? AND status = <expected>` and requires exactly one row, and (3) appends an
`order_events` row (append-only by trigger). Money-moving operations also take a row lock
(`SELECT … FOR UPDATE`) on the order. This makes double-clicks, duplicate webhooks and racing
staff/merchant actions safe: exactly one wins, the others get `409`.

See [ORDER_STATE_MACHINE.md](../ORDER_STATE_MACHINE.md).
