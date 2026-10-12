import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FulfilmentStatus, Order, OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { DISPUTE_WINDOW_DAYS, MAX_DELIVERY_ATTEMPTS } from '../../config/constants';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit.service';
import { decryptField } from '../../common/crypto';
import { PrismaService, Tx } from '../../common/prisma.service';
import { FulfilmentService } from '../fulfilment/fulfilment.service';
import { NotificationService } from '../notifications/notification.service';
import { RefundsService } from '../payments/refunds.service';
import { SettlementsService } from '../settlements/settlements.service';
import { InventoryService } from './inventory.service';
import { Actor, OrderStateService, SYSTEM } from './order-state.service';
import {
  DELIVERY_METHODS,
  isCollection,
  MERCHANT_CANCELLABLE_PAID,
  STATUS_LABEL,
  UNPAID_CANCELLABLE,
} from './order-state-machine';

export const ORDER_DETAIL_INCLUDE = {
  items: true,
  events: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  fulfilment: {
    include: {
      collectionPoint: true,
      assignments: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  },
  disputes: {
    orderBy: { createdAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  },
  review: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  settlement: true,
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderState: OrderStateService,
    private readonly inventory: InventoryService,
    private readonly fulfilment: FulfilmentService,
    private readonly settlements: SettlementsService,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async detail(where: Prisma.OrderWhereInput): Promise<OrderDetail> {
    const o = await this.prisma.order.findFirst({ where, include: ORDER_DETAIL_INCLUDE });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  // ── Views ──────────────────────────────────────────────────────────────

  /** Customer-facing view. */
  customerView(o: OrderDetail) {
    const f = o.fulfilment;
    const paid = !!o.paidAt;
    const lastDispute = o.disputes[0];
    const completedRecently =
      o.status === OrderStatus.COMPLETED &&
      o.completedAt &&
      Date.now() - o.completedAt.getTime() < DISPUTE_WINDOW_DAYS * 86400_000;
    const openDispute = o.disputes.find((d) =>
      ['OPEN', 'AWAITING_MERCHANT', 'UNDER_REVIEW'].includes(d.status),
    );
    const disputable: OrderStatus[] = [
      OrderStatus.DELIVERED,
      OrderStatus.DISPATCHED,
      OrderStatus.READY_FOR_COLLECTION,
      OrderStatus.PREPARING,
      OrderStatus.ACCEPTED_FOR_FULFILMENT,
    ];
    return {
      ...this.baseView(o),
      fulfilment: f && {
        method: f.method,
        status: f.status,
        collectionPoint: f.collectionPoint
          ? {
              name: f.collectionPoint.name,
              address: f.collectionPoint.publicAddress,
              openingHours: f.collectionPoint.openingHours,
            }
          : null,
        // The collection code is shown only once the order is paid.
        collectionCode:
          paid && isCollection(f.method) && o.status !== OrderStatus.CANCELLED
            ? decryptField(f.collectionCodeEnc)
            : null,
        deliveryAddress: decryptField(f.deliveryAddressEnc),
        recipientPhone: f.recipientPhone,
        rider:
          f.assignments[0] && f.status === FulfilmentStatus.DISPATCHED
            ? {
                partner: f.assignments[0].partnerName,
                name: f.assignments[0].riderName,
                phone: f.assignments[0].riderPhone,
              }
            : null,
        failedAttempts: f.failedAttempts,
        liveTracking: false,
        events: f.events
          .filter((e) => e.type !== 'COLLECTION_CODE_REJECTED')
          .map((e) => ({ type: e.type, note: e.note, at: e.createdAt })),
      },
      dispute: lastDispute
        ? {
            id: lastDispute.id,
            status: lastDispute.status,
            reason: lastDispute.reason,
            resolution: lastDispute.resolution,
            messages: lastDispute.messages.map((m) => ({
              id: m.id,
              authorRole: m.authorRole,
              body: m.body,
              createdAt: m.createdAt,
              evidenceCount: m.evidenceKeys.length,
            })),
          }
        : null,
      review: o.review
        ? {
            rating: o.review.rating,
            body: o.review.body,
            merchantResponse: o.review.merchantResponse,
          }
        : null,
      actions: {
        canPay: (
          [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_PENDING_VERIFICATION] as OrderStatus[]
        ).includes(o.status),
        canCancel: UNPAID_CANCELLABLE.includes(o.status) || o.status === OrderStatus.PAID,
        canConfirmReceipt: o.status === OrderStatus.DELIVERED,
        canDispute: !openDispute && (disputable.includes(o.status) || !!completedRecently),
        canReview:
          !o.review &&
          !!o.customerId &&
          ([OrderStatus.DELIVERED, OrderStatus.COMPLETED] as OrderStatus[]).includes(o.status),
      },
    };
  }

  /**
   * Merchant-facing view. Customer contact details and delivery address are only disclosed once
   * the order is paid (data minimisation: unpaid enquiries don't need them).
   */
  merchantView(o: OrderDetail) {
    const paid = !!o.paidAt && o.status !== OrderStatus.CANCELLED;
    const f = o.fulfilment;
    const guestName = (o.termsSnapshot as { guestName?: string } | null)?.guestName;
    const name = o.customer?.name ?? guestName ?? 'Guest customer';
    return {
      ...this.baseView(o),
      customer: paid
        ? { name, phone: f?.recipientPhone ?? o.customer?.phone ?? o.guestPhone ?? null }
        : { name: name.split(' ')[0], phone: null },
      fulfilment: f && {
        method: f.method,
        status: f.status,
        collectionPoint: f.collectionPoint
          ? { name: f.collectionPoint.name, address: f.collectionPoint.publicAddress }
          : null,
        deliveryAddress: paid ? decryptField(f.deliveryAddressEnc) : null,
        failedAttempts: f.failedAttempts,
        pickupFromMerchant: f.pickupFromMerchant,
        assignments: f.assignments.map((a) => ({
          partner: a.partnerName,
          rider: a.riderName,
          riderPhone: a.riderPhone,
          status: a.status,
          at: a.createdAt,
        })),
        events: f.events.map((e) => ({ type: e.type, note: e.note, at: e.createdAt })),
      },
      settlement: o.settlement && {
        status: o.settlement.status,
        commissionMinor: o.settlement.commissionMinor,
        merchantNetMinor: o.settlement.merchantNetMinor,
        refundedMinor: o.settlement.refundedMinor,
        mode: o.settlement.mode,
        payoutReference: o.settlement.payoutReference,
      },
      dispute: o.disputes[0]
        ? {
            id: o.disputes[0].id,
            status: o.disputes[0].status,
            reason: o.disputes[0].reason,
            description: o.disputes[0].description,
            messages: o.disputes[0].messages.map((m) => ({
              id: m.id,
              authorRole: m.authorRole,
              body: m.body,
              createdAt: m.createdAt,
            })),
          }
        : null,
      review: o.review
        ? {
            id: o.review.id,
            rating: o.review.rating,
            body: o.review.body,
            merchantResponse: o.review.merchantResponse,
          }
        : null,
      actions: {
        canConfirm: o.status === OrderStatus.PENDING_MERCHANT_CONFIRMATION,
        canReject: o.status === OrderStatus.PENDING_MERCHANT_CONFIRMATION,
        canAccept: o.status === OrderStatus.PAID,
        canStartPreparing: o.status === OrderStatus.ACCEPTED_FOR_FULFILMENT,
        canMarkReady: o.status === OrderStatus.PREPARING && isCollection(o.fulfilmentMethod),
        canDispatch:
          o.status === OrderStatus.PREPARING && DELIVERY_METHODS.includes(o.fulfilmentMethod),
        canMarkDelivered: o.status === OrderStatus.DISPATCHED,
        canReportFailedDelivery: o.status === OrderStatus.DISPATCHED,
        canVerifyCollection: o.status === OrderStatus.READY_FOR_COLLECTION,
        canCancel: MERCHANT_CANCELLABLE_PAID.includes(o.status),
      },
    };
  }

  private baseView(o: OrderDetail) {
    const refundedMinor = o.refunds
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((n, r) => n + r.amountMinor, 0);
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status],
      merchant: o.merchantSnapshot,
      items: o.items.map((i) => ({
        id: i.id,
        title: i.productTitle,
        variantName: i.variantName,
        unitPriceMinor: i.unitPriceMinor,
        quantity: i.quantity,
        lineTotalMinor: i.lineTotalMinor,
        stockMode: i.stockMode,
        leadTimeDays: i.leadTimeDays,
        listingId: i.listingId,
      })),
      subtotalMinor: o.subtotalMinor,
      deliveryFeeMinor: o.deliveryFeeMinor,
      serviceFeeMinor: o.serviceFeeMinor,
      totalMinor: o.totalMinor,
      currency: o.currency,
      fulfilmentMethod: o.fulfilmentMethod,
      customerNote: o.customerNote,
      merchantNote: o.merchantNote,
      cancellationReason: o.cancellationReason,
      terms: o.termsSnapshot,
      confirmationDeadline: o.confirmationDeadline,
      paymentDeadline: o.paymentDeadline,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      completedAt: o.completedAt,
      timeline: o.events.map((e) => ({
        status: e.toStatus,
        label: STATUS_LABEL[e.toStatus],
        note: e.note,
        actor: e.actorType,
        at: e.createdAt,
      })),
      payments: o.payments.map((p) => ({
        reference: p.reference,
        provider: p.provider,
        status: p.status,
        amountMinor: p.amountMinor,
        testMode: p.isTestMode,
        isDuplicate: p.isDuplicate,
        paidAt: p.paidAt,
        failureReason: p.status === 'FAILED' ? p.failureReason : null,
      })),
      refunds: o.refunds.map((r) => ({
        id: r.id,
        amountMinor: r.amountMinor,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
      refundedMinor,
    };
  }

  // ── Customer actions ───────────────────────────────────────────────────

  async customerCancel(order: Order, actor: Actor, reason: string) {
    if (UNPAID_CANCELLABLE.includes(order.status)) {
      // If a payment attempt is open, make sure it hasn't actually succeeded before cancelling.
      const open = await this.prisma.paymentTransaction.count({
        where: {
          orderId: order.id,
          status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] },
        },
      });
      if (open > 0 && order.status === OrderStatus.PAYMENT_PENDING_VERIFICATION) {
        throw new ConflictException({
          message: 'A payment is being verified for this order. Please wait a moment and refresh.',
          code: 'PAYMENT_IN_PROGRESS',
        });
      }
      return this.cancelUnpaid(order.id, actor, reason || 'Cancelled by customer');
    }
    if (order.status === OrderStatus.PAID) {
      return this.cancelPaid(order.id, actor, reason || 'Cancelled by customer before acceptance');
    }
    throw new ConflictException(
      'This order can no longer be cancelled directly. Open a dispute and our team will help.',
    );
  }

  async confirmReceipt(order: Order, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.orderState.lock(tx, order.id);
      await this.orderState.transition(
        tx,
        o,
        OrderStatus.COMPLETED,
        actor,
        'Customer confirmed receipt',
        { completedAt: new Date() },
      );
      await this.settlements.markEligible(tx, o.id);
    });
  }

  // ── Merchant actions ───────────────────────────────────────────────────

  async merchantConfirm(order: Order, actor: Actor, note?: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.orderState.lock(tx, order.id);
      await this.orderState.transition(
        tx,
        o,
        OrderStatus.AWAITING_PAYMENT,
        actor,
        note || 'Seller confirmed availability',
        {
          confirmedAt: new Date(),
          merchantNote: note,
          paymentDeadline: new Date(Date.now() + env().PAYMENT_WINDOW_MINUTES * 60_000),
        },
      );
      await this.notifyCustomer(
        tx,
        o,
        'order.confirmed',
        `Order ${o.number} confirmed — please pay`,
        `The seller confirmed your items are available. Pay within ${Math.round(env().PAYMENT_WINDOW_MINUTES / 60)} hours to secure your order.`,
      );
    });
  }

  async merchantReject(order: Order, actor: Actor, reason: string) {
    if (order.status !== OrderStatus.PENDING_MERCHANT_CONFIRMATION)
      throw new ConflictException('Only orders awaiting confirmation can be declined');
    return this.cancelUnpaid(order.id, actor, `Seller could not fulfil: ${reason}`);
  }

  async merchantAccept(order: Order, actor: Actor) {
    await this.simple(
      order,
      OrderStatus.ACCEPTED_FOR_FULFILMENT,
      actor,
      'Seller accepted the order',
      async (tx, o) => {
        await this.notifyCustomer(
          tx,
          o,
          'order.accepted',
          `Order ${o.number} accepted`,
          'The seller has accepted your order and will begin preparing it.',
        );
      },
    );
  }

  async merchantPreparing(order: Order, actor: Actor) {
    await this.simple(order, OrderStatus.PREPARING, actor, 'Preparation started', async (tx, o) => {
      await this.fulfilment.setStatus(tx, o.id, FulfilmentStatus.PREPARING, actor.userId);
    });
  }

  async merchantReady(order: Order, actor: Actor) {
    if (!isCollection(order.fulfilmentMethod))
      throw new BadRequestException('This order is for delivery; dispatch it instead');
    await this.simple(
      order,
      OrderStatus.READY_FOR_COLLECTION,
      actor,
      'Ready for collection',
      async (tx, o) => {
        await this.fulfilment.setStatus(
          tx,
          o.id,
          FulfilmentStatus.READY_FOR_COLLECTION,
          actor.userId,
        );
        await this.notifyCustomer(
          tx,
          o,
          'order.ready',
          `Order ${o.number} is ready for collection`,
          'Bring your collection code (shown on your order page) when you collect.',
          ['EMAIL', 'SMS'],
        );
      },
    );
  }

  async dispatch(
    order: Order,
    actor: Actor & { userId: string },
    input: {
      partnerName: string;
      riderName?: string;
      riderPhone?: string;
      note?: string;
      logisticsCostMinor?: number;
    },
  ) {
    if (!DELIVERY_METHODS.includes(order.fulfilmentMethod))
      throw new BadRequestException('This order is for collection');
    await this.simple(
      order,
      OrderStatus.DISPATCHED,
      actor,
      `Dispatched via ${input.partnerName}`,
      async (tx, o) => {
        await this.fulfilment.dispatch(tx, o.id, input, actor.userId);
        await this.notifyCustomer(
          tx,
          o,
          'order.dispatched',
          `Order ${o.number} is on its way`,
          `Your order has been dispatched with ${input.partnerName}${input.riderPhone ? ` (rider: ${input.riderPhone})` : ''}.`,
          ['EMAIL', 'SMS'],
        );
      },
    );
  }

  async markDelivered(order: Order, actor: Actor & { userId: string }, note?: string) {
    await this.simple(order, OrderStatus.DELIVERED, actor, note || 'Delivered', async (tx, o) => {
      await this.fulfilment.delivered(tx, o.id, actor.userId, note);
      await this.notifyCustomer(
        tx,
        o,
        'order.delivered',
        `Order ${o.number} delivered`,
        `Please confirm receipt, or open a dispute within ${env().AUTO_COMPLETE_DAYS} days if something is wrong.`,
      );
    });
  }

  async verifyCollection(order: Order, actor: Actor & { userId: string }, code: string) {
    if (order.status !== OrderStatus.READY_FOR_COLLECTION)
      throw new ConflictException('Order is not ready for collection');
    await this.fulfilment.checkCollectionCode(order.id, code, actor.userId);
    await this.simple(
      order,
      OrderStatus.DELIVERED,
      actor,
      'Collected by customer (code verified)',
      async (tx, o) => {
        await this.fulfilment.setStatus(
          tx,
          o.id,
          FulfilmentStatus.COLLECTED,
          actor.userId,
          'Collection code verified',
        );
        // A verified in-person handover completes the order immediately.
        await this.orderState.transition(
          tx,
          o,
          OrderStatus.COMPLETED,
          SYSTEM,
          'Completed on verified collection',
          { completedAt: new Date() },
        );
        await this.settlements.markEligible(tx, o.id);
      },
    );
  }

  async failedDelivery(order: Order, actor: Actor & { userId: string }, note: string) {
    await this.simple(
      order,
      OrderStatus.PREPARING,
      actor,
      `Delivery attempt failed: ${note}`,
      async (tx, o) => {
        const f = await this.fulfilment.failedAttempt(tx, o.id, actor.userId, note);
        const extra =
          f.failedAttempts >= MAX_DELIVERY_ATTEMPTS
            ? ' We will contact you to arrange a refund if delivery cannot be completed.'
            : ' We will arrange another attempt.';
        await this.notifyCustomer(
          tx,
          o,
          'order.delivery_failed',
          `Delivery attempt for ${o.number} was unsuccessful`,
          `${note}.${extra}`,
          ['EMAIL', 'SMS'],
        );
      },
    );
  }

  /** Merchant/staff cancellation of a paid order before delivery: full refund. */
  async cancelPaid(orderId: string, actor: Actor, reason: string) {
    const refundId = await this.prisma.$transaction(async (tx) => {
      const o = await this.orderState.lock(tx, orderId);
      if (!MERCHANT_CANCELLABLE_PAID.includes(o.status))
        throw new ConflictException('This order cannot be cancelled at this stage');
      await this.orderState.transition(tx, o, OrderStatus.REFUND_PENDING, actor, reason, {
        cancellationReason: reason,
        cancelledBy: actor.type,
        cancelledAt: new Date(),
      });
      await tx.fulfilment.update({
        where: { orderId },
        data: { status: FulfilmentStatus.CANCELLED },
      });
      const refund = await this.refunds.refundWholeOrder(
        tx,
        orderId,
        reason,
        actor,
        `cancel:${orderId}`,
      );
      await this.audit.record(
        {
          action: 'order.cancelled_with_refund',
          entityType: 'order',
          entityId: orderId,
          merchantId: o.merchantId,
          actor: null,
          metadata: {
            reason,
            actorType: actor.type,
            actorUserId: actor.userId,
            refundId: refund.id,
          },
        },
        tx,
      );
      await this.notifyCustomer(
        tx,
        o,
        'order.cancelled',
        `Order ${o.number} cancelled — refund started`,
        `${reason}. A full refund of your payment has been started.`,
      );
      return refund.id;
    });
    // Outside the transaction: talk to the provider.
    await this.refunds.process(refundId);
  }

  async cancelUnpaid(orderId: string, actor: Actor, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.orderState.lock(tx, orderId);
      if (!UNPAID_CANCELLABLE.includes(o.status))
        throw new ConflictException('This order cannot be cancelled without a refund');
      await this.orderState.transition(tx, o, OrderStatus.CANCELLED, actor, reason, {
        cancellationReason: reason,
        cancelledBy: actor.type,
        cancelledAt: new Date(),
      });
      if (o.stockReserved && !o.stockCommitted) {
        const items = await tx.orderItem.findMany({ where: { orderId } });
        await this.inventory.release(tx, items);
        await tx.order.update({ where: { id: orderId }, data: { stockReserved: false } });
      }
      await tx.fulfilment.update({
        where: { orderId },
        data: { status: FulfilmentStatus.CANCELLED },
      });
      await tx.paymentTransaction.updateMany({
        where: { orderId, status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] } },
        data: { status: PaymentStatus.ABANDONED, failureReason: 'Order cancelled' },
      });
      await this.notifyCustomer(
        tx,
        o,
        'order.cancelled',
        `Order ${o.number} cancelled`,
        `${reason}. You have not been charged.`,
      );
    });
  }

  private async simple(
    order: Order,
    to: OrderStatus,
    actor: Actor,
    note: string,
    extra?: (tx: Tx, o: Order) => Promise<void>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.orderState.lock(tx, order.id);
      await this.orderState.transition(tx, o, to, actor, note);
      if (extra) await extra(tx, o);
    });
  }

  async notifyCustomer(
    tx: Tx,
    o: Order,
    template: string,
    subject: string,
    body: string,
    channels: ('EMAIL' | 'SMS')[] = ['EMAIL'],
  ) {
    const user = o.customerId ? await tx.user.findUnique({ where: { id: o.customerId } }) : null;
    const f = await tx.fulfilment.findUnique({ where: { orderId: o.id } });
    await this.notifications.enqueue(
      {
        userId: o.customerId,
        email: user?.email ?? o.guestEmail,
        phone: f?.recipientPhone ?? o.guestPhone,
        channels,
        template,
        subject,
        body,
        data: { orderId: o.id },
      },
      tx,
    );
  }

  // ── Jobs ───────────────────────────────────────────────────────────────

  async expireConfirmations(): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING_MERCHANT_CONFIRMATION,
        confirmationDeadline: { lt: new Date() },
      },
      take: 50,
    });
    for (const o of due)
      await this.cancelUnpaid(o.id, SYSTEM, 'Seller did not confirm availability in time').catch(
        () => undefined,
      );
    return due.length;
  }

  /**
   * Cancel orders whose payment window closed. Orders with an open attempt are first
   * re-verified with the provider, so a payment that did succeed is never discarded; a success
   * that still arrives after cancellation is refunded automatically (PaymentsService).
   */
  async expirePayments(verify: (reference: string) => Promise<unknown>): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_PENDING_VERIFICATION] },
        paymentDeadline: { lt: new Date() },
      },
      include: {
        payments: { where: { status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] } } },
      },
      take: 50,
    });
    let cancelled = 0;
    for (const o of due) {
      for (const p of o.payments) await verify(p.reference).catch(() => undefined);
      const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      if (
        fresh.status === OrderStatus.AWAITING_PAYMENT ||
        (fresh.status === OrderStatus.PAYMENT_PENDING_VERIFICATION &&
          fresh.paymentDeadline! < new Date(Date.now() - 30 * 60_000))
      ) {
        await this.cancelUnpaid(o.id, SYSTEM, 'Payment was not completed in time').catch(
          () => undefined,
        );
        cancelled++;
      }
    }
    return cancelled;
  }

  async autoComplete(): Promise<number> {
    const cutoff = new Date(Date.now() - env().AUTO_COMPLETE_DAYS * 86400_000);
    const due = await this.prisma.order.findMany({
      where: { status: OrderStatus.DELIVERED, fulfilment: { completedAt: { lt: cutoff } } },
      take: 100,
    });
    for (const o of due) {
      await this.prisma
        .$transaction(async (tx) => {
          const locked = await this.orderState.lock(tx, o.id);
          await this.orderState.transition(
            tx,
            locked,
            OrderStatus.COMPLETED,
            SYSTEM,
            `Auto-completed ${env().AUTO_COMPLETE_DAYS} days after delivery`,
            { completedAt: new Date() },
          );
          await this.settlements.markEligible(tx, o.id);
        })
        .catch(() => undefined);
    }
    return due.length;
  }

  assertCustomerOwns(order: Order, userId: string | undefined) {
    if (!userId || order.customerId !== userId) throw new ForbiddenException();
  }
}
