import { FulfilmentMethod, OrderStatus as S } from '@prisma/client';

/**
 * Explicit order state machine. Every status change in the system goes through
 * OrdersService.transition(), which checks this table and performs a compare-and-set update,
 * so invalid or concurrent duplicate transitions are rejected at the database level.
 *
 * See docs/ORDER_STATE_MACHINE.md for the diagram and the actor allowed to make each move.
 */
export const ORDER_TRANSITIONS: Readonly<Record<S, readonly S[]>> = {
  [S.DRAFT]: [S.PENDING_MERCHANT_CONFIRMATION, S.AWAITING_PAYMENT, S.CANCELLED],
  [S.PENDING_MERCHANT_CONFIRMATION]: [S.AWAITING_PAYMENT, S.CANCELLED],
  [S.AWAITING_PAYMENT]: [S.PAYMENT_PENDING_VERIFICATION, S.PAID, S.CANCELLED],
  // Failed / abandoned payment returns the order to AWAITING_PAYMENT so the customer may retry.
  [S.PAYMENT_PENDING_VERIFICATION]: [S.PAID, S.AWAITING_PAYMENT, S.CANCELLED],
  [S.PAID]: [S.ACCEPTED_FOR_FULFILMENT, S.REFUND_PENDING, S.DISPUTED],
  [S.ACCEPTED_FOR_FULFILMENT]: [S.PREPARING, S.REFUND_PENDING, S.DISPUTED],
  [S.PREPARING]: [S.READY_FOR_COLLECTION, S.DISPATCHED, S.REFUND_PENDING, S.DISPUTED],
  [S.READY_FOR_COLLECTION]: [S.DELIVERED, S.REFUND_PENDING, S.DISPUTED],
  // A failed delivery attempt returns the order to PREPARING for re-dispatch.
  [S.DISPATCHED]: [S.DELIVERED, S.PREPARING, S.REFUND_PENDING, S.DISPUTED],
  [S.DELIVERED]: [S.COMPLETED, S.DISPUTED],
  [S.COMPLETED]: [S.DISPUTED],
  // Dispute resolution: restore the prior fulfilment status, complete, or refund.
  [S.DISPUTED]: [
    S.PAID,
    S.ACCEPTED_FOR_FULFILMENT,
    S.PREPARING,
    S.READY_FOR_COLLECTION,
    S.DISPATCHED,
    S.DELIVERED,
    S.COMPLETED,
    S.REFUND_PENDING,
  ],
  [S.REFUND_PENDING]: [S.REFUNDED],
  [S.CANCELLED]: [],
  [S.REFUNDED]: [],
};

export const TERMINAL_STATUSES: readonly S[] = [S.CANCELLED, S.REFUNDED];

/** Statuses in which the customer has paid and money is held by the provider/merchant. */
export const PAID_STATUSES: readonly S[] = [
  S.PAID,
  S.ACCEPTED_FOR_FULFILMENT,
  S.PREPARING,
  S.READY_FOR_COLLECTION,
  S.DISPATCHED,
  S.DELIVERED,
  S.COMPLETED,
  S.DISPUTED,
  S.REFUND_PENDING,
  S.REFUNDED,
];

/** Statuses from which the merchant (or staff) may cancel a paid order with a full refund. */
export const MERCHANT_CANCELLABLE_PAID: readonly S[] = [
  S.PAID,
  S.ACCEPTED_FOR_FULFILMENT,
  S.PREPARING,
  S.READY_FOR_COLLECTION,
  S.DISPATCHED,
];

/** Pre-payment statuses: cancellation needs no refund. */
export const UNPAID_CANCELLABLE: readonly S[] = [
  S.DRAFT,
  S.PENDING_MERCHANT_CONFIRMATION,
  S.AWAITING_PAYMENT,
  S.PAYMENT_PENDING_VERIFICATION,
];

/** Statuses in which a customer may open a dispute. */
export const DISPUTABLE: readonly S[] = [
  S.PAID,
  S.ACCEPTED_FOR_FULFILMENT,
  S.PREPARING,
  S.READY_FOR_COLLECTION,
  S.DISPATCHED,
  S.DELIVERED,
  S.COMPLETED,
];

export function canTransition(from: S, to: S): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: S,
    readonly to: S,
  ) {
    super(`Order cannot move from ${from} to ${to}`);
  }
}

export function assertTransition(from: S, to: S): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const COLLECTION_METHODS: readonly FulfilmentMethod[] = [
  FulfilmentMethod.IN_STORE_COLLECTION,
  FulfilmentMethod.COLLECTION_POINT,
];

export const DELIVERY_METHODS: readonly FulfilmentMethod[] = [
  FulfilmentMethod.MERCHANT_DELIVERY,
  FulfilmentMethod.THIRD_PARTY_DELIVERY,
];

export function isCollection(method: FulfilmentMethod): boolean {
  return COLLECTION_METHODS.includes(method);
}

/** Customer-friendly label for each status. */
export const STATUS_LABEL: Record<S, string> = {
  DRAFT: 'Draft',
  PENDING_MERCHANT_CONFIRMATION: 'Waiting for seller to confirm availability',
  AWAITING_PAYMENT: 'Confirmed — awaiting payment',
  PAYMENT_PENDING_VERIFICATION: 'Payment being verified',
  PAID: 'Paid',
  ACCEPTED_FOR_FULFILMENT: 'Accepted by seller',
  PREPARING: 'Being prepared',
  READY_FOR_COLLECTION: 'Ready for collection',
  DISPATCHED: 'Out for delivery',
  DELIVERED: 'Delivered / collected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund in progress',
  REFUNDED: 'Refunded',
  DISPUTED: 'Under dispute',
};
