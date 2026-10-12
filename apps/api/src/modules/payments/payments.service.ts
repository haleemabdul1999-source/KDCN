import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderStatus, PaymentProvider, PaymentStatus, Prisma, SettlementMode } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { FulfilmentService } from '../fulfilment/fulfilment.service';
import { NotificationService } from '../notifications/notification.service';
import { InventoryService } from '../orders/inventory.service';
import { Actor, OrderStateService } from '../orders/order-state.service';
import { SettlementsService } from '../settlements/settlements.service';
import { ProviderRegistry } from './provider.registry';
import { ProviderUnavailableError, VerifyResult } from './providers/payment-provider';
import { RefundsService } from './refunds.service';

export type ApplyOutcome =
  | 'paid'
  | 'already_applied'
  | 'failed'
  | 'pending'
  | 'duplicate_payment_refund_raised'
  | 'late_payment_refund_raised'
  | 'amount_mismatch';

/**
 * Payment lifecycle. Invariants:
 *  1. An order becomes PAID only after the provider's server-side verification API confirms
 *     success for OUR reference, for the exact amount and currency we requested.
 *  2. Webhooks are stored first (unique per provider event) and only trigger verification;
 *     the webhook body itself is never trusted for amounts or status.
 *  3. Applying a verification is idempotent: the payment row is locked and re-checked.
 *  4. A success that arrives for an order that is already paid or cancelled is recorded and
 *     an automatic refund is raised — money is never silently kept.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly orderState: OrderStateService,
    private readonly inventory: InventoryService,
    private readonly settlements: SettlementsService,
    private readonly fulfilment: FulfilmentService,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /** Start (or restart) payment for an order awaiting payment. */
  async initiate(orderId: string, actor: Actor) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, merchant: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const payable: OrderStatus[] = [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_PENDING_VERIFICATION];
    if (!payable.includes(order.status)) {
      throw new ConflictException({ message: 'This order is not awaiting payment', code: 'NOT_PAYABLE', status: order.status });
    }
    if (order.paymentDeadline && order.paymentDeadline < new Date()) {
      throw new ConflictException({ message: 'The payment window for this order has closed', code: 'PAYMENT_WINDOW_CLOSED' });
    }
    // Before creating a new attempt, check whether an earlier attempt actually succeeded.
    const pending = await this.prisma.paymentTransaction.findMany({
      where: { orderId, status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] } },
    });
    for (const p of pending) {
      const outcome = await this.verifyAndApply(p.reference, 'initiate_precheck').catch(() => null);
      if (outcome === 'paid' || outcome === 'already_applied') {
        throw new ConflictException({ message: 'This order has already been paid', code: 'ALREADY_PAID' });
      }
    }

    const provider = this.providers.active();
    const reference = `KDCN-${order.number}-${randomBytes(4).toString('hex')}`.toUpperCase();
    const email = order.customer?.email ?? order.guestEmail;
    if (!email) throw new BadRequestException('An email address is required for payment');

    const useSplit = order.merchant.settlementMode === SettlementMode.PROVIDER_SPLIT && !!order.merchant.providerSubaccountCode;
    const merchantDelivery = order.fulfilmentMethod === 'MERCHANT_DELIVERY' ? order.deliveryFeeMinor : 0;
    const platformShare = order.totalMinor - (order.subtotalMinor - order.commissionMinor + merchantDelivery);

    const payment = await this.prisma.paymentTransaction.create({
      data: {
        orderId,
        provider: provider.id,
        reference,
        amountMinor: order.totalMinor,
        currency: order.currency,
        status: PaymentStatus.INITIATED,
        isTestMode: provider.isTestMode,
      },
    });
    let init;
    try {
      init = await provider.initialize({
        reference,
        amountMinor: order.totalMinor,
        currency: 'NGN',
        email,
        callbackUrl: `${env().WEB_BASE_URL}/orders/${order.id}/payment-return?reference=${encodeURIComponent(reference)}`,
        metadata: { orderId: order.id, orderNumber: order.number, merchantId: order.merchantId },
        split: useSplit ? { subaccountCode: order.merchant.providerSubaccountCode!, platformShareMinor: platformShare } : undefined,
      });
    } catch (e) {
      await this.prisma.paymentTransaction.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: `initialize_failed: ${(e as Error).message}`.slice(0, 300) },
      });
      this.logger.warn({ msg: 'payment.initialize_failed', orderId, provider: provider.id, error: (e as Error).message });
      if (e instanceof ProviderUnavailableError) {
        throw new ServiceUnavailableException('Payment provider is temporarily unavailable. Your order is saved — please try again shortly.');
      }
      throw new ServiceUnavailableException('Could not start payment. Please try again.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: PaymentStatus.PENDING, authorizationUrl: init.authorizationUrl } });
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (fresh.status === OrderStatus.AWAITING_PAYMENT) {
        await this.orderState.transition(tx, fresh, OrderStatus.PAYMENT_PENDING_VERIFICATION, actor, `Payment started (${provider.id})`);
      }
    });
    return { reference, authorizationUrl: init.authorizationUrl, provider: provider.id, testMode: provider.isTestMode };
  }

  /** Server-side verification with the provider, then idempotent application. */
  async verifyAndApply(reference: string, source: string): Promise<ApplyOutcome> {
    const payment = await this.prisma.paymentTransaction.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.SUCCEEDED) return 'already_applied';
    const result = await this.providers.get(payment.provider).verify(reference);
    return this.applyVerification(payment.id, result, source);
  }

  async applyVerification(paymentId: string, result: VerifyResult, source: string): Promise<ApplyOutcome> {
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<{ outcome: ApplyOutcome; notify?: () => Promise<void> }> => {
        const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: paymentId } });
        // Lock order first (consistent lock ordering: order → payment).
        const order = await this.orderState.lock(tx, payment.orderId);
        await tx.$queryRaw`SELECT id FROM payment_transactions WHERE id = ${paymentId} FOR UPDATE`;
        const current = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: paymentId } });
        if (current.status === PaymentStatus.SUCCEEDED) return { outcome: 'already_applied' };
        if (result.reference !== current.reference) {
          throw new Error(`Provider verification reference mismatch for payment ${paymentId}`);
        }

        if (result.status === 'pending') return { outcome: 'pending' };

        if (result.status === 'failed' || result.status === 'abandoned') {
          await tx.paymentTransaction.update({
            where: { id: paymentId },
            data: {
              status: result.status === 'failed' ? PaymentStatus.FAILED : PaymentStatus.ABANDONED,
              failureReason: result.gatewayMessage ?? result.status,
              verifiedAt: new Date(),
              rawVerification: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            },
          });
          // Return the order to AWAITING_PAYMENT if no other attempt is still open.
          const open = await tx.paymentTransaction.count({
            where: { orderId: order.id, id: { not: paymentId }, status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] } },
          });
          if (order.status === OrderStatus.PAYMENT_PENDING_VERIFICATION && open === 0) {
            await this.orderState.transition(tx, order, OrderStatus.AWAITING_PAYMENT, { type: 'provider' }, `Payment ${result.status}: ${result.gatewayMessage ?? ''}`.trim());
          }
          return { outcome: 'failed' };
        }

        // status === 'success'
        if (result.amountMinor !== current.amountMinor || result.currency !== current.currency) {
          await tx.paymentTransaction.update({
            where: { id: paymentId },
            data: { status: PaymentStatus.FAILED, failureReason: `amount_mismatch: expected ${current.amountMinor} ${current.currency}, got ${result.amountMinor} ${result.currency}`, verifiedAt: new Date(), rawVerification: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue },
          });
          await this.audit.record({ action: 'payment.amount_mismatch', entityType: 'payment', entityId: paymentId, merchantId: order.merchantId, metadata: { expected: current.amountMinor, got: result.amountMinor, source } }, tx);
          this.logger.error({ msg: 'payment.amount_mismatch', paymentId, orderId: order.id });
          return { outcome: 'amount_mismatch' };
        }

        const payable: OrderStatus[] = [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_PENDING_VERIFICATION];
        const isDuplicate = !payable.includes(order.status);
        await tx.paymentTransaction.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.SUCCEEDED,
            isDuplicate,
            providerTransactionId: result.providerTransactionId,
            providerFeeMinor: result.feeMinor ?? null,
            channel: result.channel,
            paidAt: result.paidAt ?? new Date(),
            verifiedAt: new Date(),
            rawVerification: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          },
        });

        if (isDuplicate) {
          // Money received for an order that is already paid (second attempt) or no longer payable
          // (cancelled after the window closed). Refund it automatically.
          const late = order.status === OrderStatus.CANCELLED;
          await this.refunds.request(tx, {
            orderId: order.id,
            paymentTransactionId: paymentId,
            amountMinor: current.amountMinor,
            reason: late ? 'Payment received after the order was cancelled' : 'Duplicate payment for an already-paid order',
            idempotencyKey: `auto-refund:${paymentId}`,
            autoApprove: true,
          });
          await this.audit.record({ action: late ? 'payment.late_payment_refund' : 'payment.duplicate_payment_refund', entityType: 'payment', entityId: paymentId, merchantId: order.merchantId, metadata: { orderId: order.id, source } }, tx);
          return { outcome: late ? 'late_payment_refund_raised' : 'duplicate_payment_refund_raised' };
        }

        // Mark the order paid.
        await this.orderState.transition(tx, order, OrderStatus.PAID, { type: 'provider' }, `Payment verified (${current.provider} ${current.reference})`, { paidAt: new Date(), stockCommitted: true });
        const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
        if (order.stockReserved && !order.stockCommitted) await this.inventory.commit(tx, items);
        const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: order.merchantId } });
        const mode = merchant.settlementMode === SettlementMode.PROVIDER_SPLIT && merchant.providerSubaccountCode ? SettlementMode.PROVIDER_SPLIT : SettlementMode.MANUAL_RECORD;
        await this.settlements.createForPaidOrder(tx, order, mode, result.feeMinor ?? null);
        await this.fulfilment.onPaid(tx, order.id);
        // Abandon other open attempts so they cannot be reused.
        await tx.paymentTransaction.updateMany({
          where: { orderId: order.id, id: { not: paymentId }, status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] } },
          data: { status: PaymentStatus.ABANDONED, failureReason: 'Superseded by successful payment' },
        });
        await this.audit.record({ action: 'payment.succeeded', entityType: 'payment', entityId: paymentId, merchantId: order.merchantId, metadata: { orderId: order.id, amountMinor: current.amountMinor, source, testMode: current.isTestMode } }, tx);

        const customer = order.customerId ? await tx.user.findUnique({ where: { id: order.customerId } }) : null;
        await this.notifications.enqueue(
          {
            userId: order.customerId,
            email: customer?.email ?? order.guestEmail,
            template: 'order.paid',
            subject: `Payment received for order ${order.number}`,
            body: `We've confirmed your payment of ₦${(current.amountMinor / 100).toLocaleString('en-NG')}. ${merchant.displayName} will now prepare your order.`,
            data: { orderId: order.id },
          },
          tx,
        );
        const members = await tx.merchantMember.findMany({ where: { merchantId: order.merchantId }, include: { user: true } });
        for (const m of members) {
          await this.notifications.enqueue(
            { userId: m.userId, email: m.user.email, template: 'merchant.order_paid', subject: `Order ${order.number} is paid — please accept it`, body: 'A customer has paid. Accept the order to begin fulfilment.', data: { orderId: order.id, merchantId: order.merchantId } },
            tx,
          );
        }
        return { outcome: 'paid' };
      },
      { timeout: 15_000 },
    );
    return outcome.outcome;
  }

  /**
   * Webhook entry point. Returns an HTTP status for the controller: 200 for anything we have
   * durably recorded (including duplicates and events we ignore), 401 for bad signatures,
   * 500 when processing failed and the provider should retry.
   */
  async handleWebhook(providerId: PaymentProvider, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ status: number; result: string }> {
    if (!this.providers.has(providerId)) return { status: 404, result: 'provider_not_configured' };
    const provider = this.providers.get(providerId);
    const parsed = provider.parseWebhook(rawBody, headers);
    if (!parsed) {
      this.logger.warn({ msg: 'webhook.invalid_signature', provider: providerId });
      await this.audit.record({ action: 'payment.webhook_invalid_signature', entityType: 'webhook', entityId: providerId, metadata: { bytes: rawBody.length } });
      return { status: 401, result: 'invalid_signature' };
    }

    // Durably record first; a redelivery hits the unique constraint.
    let eventId: string;
    try {
      const ev = await this.prisma.providerWebhookEvent.create({
        data: { provider: providerId, eventKey: parsed.eventKey, eventType: parsed.eventType, signatureValid: true, payload: parsed.payload as Prisma.InputJsonValue },
      });
      eventId = ev.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.providerWebhookEvent.update({
          where: { provider_eventKey: { provider: providerId, eventKey: parsed.eventKey } },
          data: { deliveryCount: { increment: 1 } },
        });
        if (existing.processedAt) return { status: 200, result: 'duplicate_ignored' };
        eventId = existing.id; // previously failed processing: try again
      } else {
        throw e;
      }
    }

    try {
      let result = 'ignored';
      if (parsed.kind === 'charge' && parsed.reference) {
        const payment = await this.prisma.paymentTransaction.findUnique({ where: { reference: parsed.reference } });
        if (!payment || payment.provider !== providerId) {
          result = 'unknown_reference';
        } else {
          result = await this.verifyAndApply(parsed.reference, `webhook:${parsed.eventType}`);
        }
      } else if (parsed.kind === 'refund' && parsed.providerRefundId) {
        result = await this.refunds.onRefundEvent(parsed.providerRefundId);
      }
      await this.prisma.providerWebhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), result } });
      return { status: 200, result };
    } catch (e) {
      this.logger.error({ msg: 'webhook.processing_failed', provider: providerId, eventId, error: (e as Error).message });
      await this.prisma.providerWebhookEvent.update({ where: { id: eventId }, data: { result: `error: ${(e as Error).message}`.slice(0, 300) } });
      return { status: 500, result: 'processing_failed' };
    }
  }
}
