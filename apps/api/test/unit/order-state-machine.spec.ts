import { OrderStatus as S } from '@prisma/client';
import { assertTransition, canTransition, ORDER_TRANSITIONS, TERMINAL_STATUSES } from '../../src/modules/orders/order-state-machine';

describe('order state machine', () => {
  it('defines transitions for every status', () => {
    for (const s of Object.values(S)) expect(ORDER_TRANSITIONS[s]).toBeDefined();
  });

  it('terminal states have no exits', () => {
    for (const s of TERMINAL_STATUSES) expect(ORDER_TRANSITIONS[s]).toHaveLength(0);
  });

  it.each([
    [S.PENDING_MERCHANT_CONFIRMATION, S.PAID],
    [S.AWAITING_PAYMENT, S.ACCEPTED_FOR_FULFILMENT],
    [S.PAID, S.COMPLETED],
    [S.PAID, S.CANCELLED], // paid orders are refunded, never silently cancelled
    [S.CANCELLED, S.PAID],
    [S.REFUNDED, S.REFUND_PENDING],
    [S.DELIVERED, S.REFUND_PENDING], // after delivery, refunds go through a dispute
    [S.READY_FOR_COLLECTION, S.DISPATCHED],
  ])('forbids %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(/cannot move/);
  });

  it('every non-terminal status can reach a terminal or completed state', () => {
    const goal = new Set<S>([S.COMPLETED, S.CANCELLED, S.REFUNDED]);
    for (const start of Object.values(S)) {
      const seen = new Set<S>([start]);
      const queue = [start];
      while (queue.length) for (const n of ORDER_TRANSITIONS[queue.shift()!]) if (!seen.has(n)) (seen.add(n), queue.push(n));
      expect([...seen].some((s) => goal.has(s))).toBe(true);
    }
  });

  it('the payment path requires verification before PAID', () => {
    expect(canTransition(S.AWAITING_PAYMENT, S.PAYMENT_PENDING_VERIFICATION)).toBe(true);
    expect(canTransition(S.PAYMENT_PENDING_VERIFICATION, S.PAID)).toBe(true);
    expect(canTransition(S.PAYMENT_PENDING_VERIFICATION, S.AWAITING_PAYMENT)).toBe(true);
  });
});
