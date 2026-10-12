import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma, Refund, RefundStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { AuthContext } from '../../common/auth/auth.types';
import { PrismaService, Tx } from '../../common/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { Actor, OrderStateService, SYSTEM } from '../orders/order-state.service';
import { SettlementsService } from '../settlements/settlements.service';
import { ProviderRegistry } from './provider.registry';
import { ProviderUnavailableError } from './providers/payment-provider';

const ACTIVE_REFUND: RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
  RefundStatus.SUCCEEDED,
];

export interface RefundRequest {
  orderId: string;
  paymentTransactionId?: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
  requestedById?: string | null;
  autoApprove: boolean;
  disputeId?: string;
}

/**
 * Refunds are created against a specific successful payment. Double refunds are prevented by:
 *  - an idempotency key per business event (unique constraint),
 *  - a row lock on the order while the refundable balance is computed,
 *  - compare-and-set on refund status before calling the provider.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly orderState: OrderStateService,
    private readonly settlements: SettlementsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Must be called inside a transaction. Returns the existing refund for a repeated key. */
  async request(tx: Tx, input: RefundRequest): Promise<Refund> {
    const existing = await tx.refund.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    await this.orderState.lock(tx, input.orderId);
    const payment = await tx.paymentTransaction.findFirst({
      where: {
        orderId: input.orderId,
        status: PaymentStatus.SUCCEEDED,
        ...(input.paymentTransactionId
          ? { id: input.paymentTransactionId }
          : { isDuplicate: false }),
      },
    });
    if (!payment) throw new BadRequestException('No successful payment to refund');
    const already = await tx.refund.aggregate({
      where: { paymentTransactionId: payment.id, status: { in: ACTIVE_REFUND } },
      _sum: { amountMinor: true },
    });
    const remaining = payment.amountMinor - (already._sum.amountMinor ?? 0);
    if (input.amountMinor <= 0 || input.amountMinor > remaining) {
      throw new ConflictException({
        message: `Refund exceeds refundable balance (${remaining} kobo remaining)`,
        code: 'REFUND_EXCEEDS_BALANCE',
      });
    }
    return tx.refund.create({
      data: {
        orderId: input.orderId,
        paymentTransactionId: payment.id,
        amountMinor: input.amountMinor,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requestedById: input.requestedById ?? null,
        status: input.autoApprove ? RefundStatus.APPROVED : RefundStatus.REQUESTED,
        disputeId: input.disputeId,
      },
    });
  }

  async approve(refundId: string, auth: AuthContext, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.refund.updateMany({
        where: { id: refundId, status: RefundStatus.REQUESTED },
        data: { status: RefundStatus.APPROVED, approvedById: auth.user.id },
      });
      if (res.count !== 1) throw new ConflictException('Refund is not awaiting approval');
      await this.audit.record(
        { actor: auth, action: 'refund.approved', entityType: 'refund', entityId: refundId, ip },
        tx,
      );
    });
    return this.process(refundId);
  }

  async reject(refundId: string, auth: AuthContext, reason: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund) throw new NotFoundException();
      const res = await tx.refund.updateMany({
        where: { id: refundId, status: RefundStatus.REQUESTED },
        data: { status: RefundStatus.REJECTED, failureReason: reason },
      });
      if (res.count !== 1) throw new ConflictException('Refund is not awaiting approval');
      await this.audit.record(
        {
          actor: auth,
          action: 'refund.rejected',
          entityType: 'refund',
          entityId: refundId,
          metadata: { reason },
          ip,
        },
        tx,
      );
    });
  }

  /** Retry a FAILED refund by moving it back to APPROVED. */
  async retry(refundId: string, auth: AuthContext, ip?: string) {
    const res = await this.prisma.refund.updateMany({
      where: { id: refundId, status: RefundStatus.FAILED },
      data: { status: RefundStatus.APPROVED, failureReason: null },
    });
    if (res.count !== 1) throw new ConflictException('Only failed refunds can be retried');
    await this.audit.record({
      actor: auth,
      action: 'refund.retried',
      entityType: 'refund',
      entityId: refundId,
      ip,
    });
    return this.process(refundId);
  }

  /** Send an APPROVED refund to the provider. Safe to call repeatedly. */
  async process(refundId: string): Promise<Refund> {
    const claimed = await this.prisma.refund.updateMany({
      where: { id: refundId, status: RefundStatus.APPROVED },
      data: { status: RefundStatus.PROCESSING },
    });
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { paymentTransaction: true },
    });
    if (claimed.count !== 1) return refund;
    const provider = this.providers.get(refund.paymentTransaction.provider);
    try {
      const result = await provider.refund({
        reference: refund.paymentTransaction.reference,
        amountMinor: refund.amountMinor,
        reason: refund.reason,
      });
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { providerRefundId: result.providerRefundId },
      });
      if (result.status === 'processed') return this.markSucceeded(refund.id);
      if (result.status === 'failed')
        return this.markFailed(refund.id, 'Provider rejected the refund');
      return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }); // pending: completes via webhook / reconciliation
    } catch (e) {
      const unavailable = e instanceof ProviderUnavailableError;
      this.logger.warn({
        msg: 'refund.provider_error',
        refundId,
        unavailable,
        error: (e as Error).message,
      });
      // Outage: return to APPROVED so the job retries. Hard error: FAILED for staff attention.
      if (unavailable) {
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: RefundStatus.APPROVED,
            failureReason: 'Provider unavailable; will retry',
          },
        });
        return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
      }
      return this.markFailed(refund.id, (e as Error).message.slice(0, 300));
    }
  }

  async markSucceeded(refundId: string): Promise<Refund> {
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      const order = await this.orderState.lock(tx, refund.orderId);
      const moved = await tx.refund.updateMany({
        where: { id: refundId, status: { in: [RefundStatus.PROCESSING, RefundStatus.APPROVED] } },
        data: { status: RefundStatus.SUCCEEDED, completedAt: new Date(), failureReason: null },
      });
      if (moved.count !== 1) return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      const payment = await tx.paymentTransaction.findUniqueOrThrow({
        where: { id: refund.paymentTransactionId },
      });
      if (!payment.isDuplicate) {
        const total = await tx.refund.aggregate({
          where: {
            orderId: order.id,
            status: RefundStatus.SUCCEEDED,
            paymentTransaction: { isDuplicate: false },
          },
          _sum: { amountMinor: true },
        });
        const refunded = total._sum.amountMinor ?? 0;
        await this.settlements.applyRefund(tx, order, refund.amountMinor, refunded);
        if (refunded >= order.totalMinor && order.status === OrderStatus.REFUND_PENDING) {
          await this.orderState.transition(
            tx,
            order,
            OrderStatus.REFUNDED,
            SYSTEM,
            'Refund completed by provider',
          );
        }
      }
      const recipient = order.customerId
        ? await tx.user.findUnique({ where: { id: order.customerId } })
        : null;
      await this.notifications.enqueue(
        {
          userId: order.customerId,
          email: recipient?.email ?? order.guestEmail,
          template: 'refund.succeeded',
          subject: `Refund processed for order ${order.number}`,
          body: `A refund of ₦${(refund.amountMinor / 100).toLocaleString('en-NG')} has been processed to your original payment method. Your bank may take a few working days to reflect it.`,
          data: { orderId: order.id },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'refund.succeeded',
          entityType: 'refund',
          entityId: refundId,
          merchantId: order.merchantId,
          metadata: { orderId: order.id, amountMinor: refund.amountMinor },
        },
        tx,
      );
      return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }

  async markFailed(refundId: string, reason: string): Promise<Refund> {
    await this.prisma.refund.updateMany({
      where: { id: refundId, status: { in: [RefundStatus.PROCESSING, RefundStatus.APPROVED] } },
      data: { status: RefundStatus.FAILED, failureReason: reason },
    });
    await this.audit.record({
      action: 'refund.failed',
      entityType: 'refund',
      entityId: refundId,
      metadata: { reason },
    });
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  /** Provider refund webhook: re-fetch the refund status from the provider before applying. */
  async onRefundEvent(providerRefundId: string): Promise<string> {
    const refund = await this.prisma.refund.findFirst({
      where: { providerRefundId },
      include: { paymentTransaction: true },
    });
    if (!refund) return 'refund_not_found';
    const result = await this.providers
      .get(refund.paymentTransaction.provider)
      .fetchRefund(providerRefundId);
    if (result.status === 'processed') await this.markSucceeded(refund.id);
    else if (result.status === 'failed')
      await this.markFailed(refund.id, 'Provider reported refund failure');
    return `refund_${result.status}`;
  }

  /** Job: push approved refunds and reconcile long-pending ones. */
  async processDue(): Promise<number> {
    const due = await this.prisma.refund.findMany({
      where: { status: RefundStatus.APPROVED },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });
    for (const r of due) await this.process(r.id);
    const stale = await this.prisma.refund.findMany({
      where: {
        status: RefundStatus.PROCESSING,
        providerRefundId: { not: null },
        updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      take: 20,
    });
    for (const r of stale) {
      try {
        await this.onRefundEvent(r.providerRefundId!);
      } catch (e) {
        this.logger.warn({
          msg: 'refund.reconcile_failed',
          refundId: r.id,
          error: (e as Error).message,
        });
      }
    }
    return due.length;
  }

  /** Raise a full refund for a paid order moving to REFUND_PENDING (cancellation). */
  async refundWholeOrder(
    tx: Tx,
    orderId: string,
    reason: string,
    actor: Actor,
    idempotencyKey: string,
  ): Promise<Refund> {
    const payment = await tx.paymentTransaction.findFirst({
      where: { orderId, status: PaymentStatus.SUCCEEDED, isDuplicate: false },
    });
    if (!payment) throw new BadRequestException('Order has no successful payment');
    const refunded = await tx.refund.aggregate({
      where: { paymentTransactionId: payment.id, status: { in: ACTIVE_REFUND } },
      _sum: { amountMinor: true },
    });
    const remaining = payment.amountMinor - (refunded._sum.amountMinor ?? 0);
    if (remaining <= 0) {
      const last = await tx.refund.findFirst({
        where: { paymentTransactionId: payment.id },
        orderBy: { createdAt: 'desc' },
      });
      if (last) return last;
    }
    return this.request(tx, {
      orderId,
      paymentTransactionId: payment.id,
      amountMinor: remaining,
      reason,
      idempotencyKey,
      requestedById: actor.userId,
      autoApprove: true,
    });
  }
}

export type RefundWithPayment = Prisma.RefundGetPayload<{ include: { paymentTransaction: true } }>;
