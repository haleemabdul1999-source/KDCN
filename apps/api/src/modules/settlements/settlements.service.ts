import { Injectable } from '@nestjs/common';
import { FulfilmentMethod, Order, SettlementMode, SettlementStatus } from '@prisma/client';
import { Tx } from '../../common/prisma.service';

/**
 * Settlement allocations record, per paid order, the authoritative split between merchant and
 * platform. They are records of entitlement — KDCN does not hold or delay merchant funds in
 * Release 1 (see docs/adr/0006-payments-and-settlement.md). Payout execution is either the
 * provider's split settlement or a manual transfer recorded by finance with a reference.
 *
 *   grossMinor            = order subtotal (goods)
 *   commissionMinor       = round(subtotal × commissionBps)
 *   merchantDeliveryMinor = delivery fee when the merchant delivers, else 0
 *   merchantNetMinor      = gross − commission + merchantDelivery − refunds borne by merchant
 */
@Injectable()
export class SettlementsService {
  async createForPaidOrder(
    tx: Tx,
    order: Order,
    mode: SettlementMode,
    providerFeeMinor: number | null,
  ) {
    const merchantDelivery =
      order.fulfilmentMethod === FulfilmentMethod.MERCHANT_DELIVERY ? order.deliveryFeeMinor : 0;
    await tx.settlementAllocation.upsert({
      where: { orderId: order.id },
      update: {},
      create: {
        orderId: order.id,
        merchantId: order.merchantId,
        mode,
        grossMinor: order.subtotalMinor,
        commissionMinor: order.commissionMinor,
        serviceFeeMinor: order.serviceFeeMinor,
        deliveryFeeMinor: order.deliveryFeeMinor,
        merchantDeliveryMinor: merchantDelivery,
        providerFeeMinor,
        merchantNetMinor: order.subtotalMinor - order.commissionMinor + merchantDelivery,
        status: SettlementStatus.PENDING_FULFILMENT,
      },
    });
  }

  async markEligible(tx: Tx, orderId: string) {
    await tx.settlementAllocation.updateMany({
      where: {
        orderId,
        status: { in: [SettlementStatus.PENDING_FULFILMENT, SettlementStatus.ON_HOLD] },
      },
      data: { status: SettlementStatus.ELIGIBLE },
    });
  }

  async hold(tx: Tx, orderId: string) {
    await tx.settlementAllocation.updateMany({
      where: {
        orderId,
        status: { in: [SettlementStatus.PENDING_FULFILMENT, SettlementStatus.ELIGIBLE] },
      },
      data: { status: SettlementStatus.ON_HOLD },
    });
  }

  async releaseHold(tx: Tx, orderId: string, completed: boolean) {
    await tx.settlementAllocation.updateMany({
      where: { orderId, status: SettlementStatus.ON_HOLD },
      data: { status: completed ? SettlementStatus.ELIGIBLE : SettlementStatus.PENDING_FULFILMENT },
    });
  }

  /** Apply a successful refund. Full refunds reverse the allocation. */
  async applyRefund(
    tx: Tx,
    order: Pick<Order, 'id' | 'totalMinor'>,
    amountMinor: number,
    totalRefundedMinor: number,
  ) {
    const s = await tx.settlementAllocation.findUnique({ where: { orderId: order.id } });
    if (!s) return;
    const full = totalRefundedMinor >= order.totalMinor;
    await tx.settlementAllocation.update({
      where: { orderId: order.id },
      data: {
        refundedMinor: totalRefundedMinor,
        merchantNetMinor: full ? 0 : Math.max(0, s.merchantNetMinor - amountMinor),
        // A refund after payout keeps SETTLED; finance sees refundedMinor > 0 and recovers it from the merchant.
        status:
          full && s.status !== SettlementStatus.SETTLED ? SettlementStatus.REVERSED : s.status,
      },
    });
  }
}
