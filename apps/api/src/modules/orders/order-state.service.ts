import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { Tx } from '../../common/prisma.service';
import { assertTransition, InvalidTransitionError } from './order-state-machine';

export type ActorType = 'customer' | 'merchant' | 'staff' | 'system' | 'provider';
export interface Actor {
  type: ActorType;
  userId?: string | null;
}

export const SYSTEM: Actor = { type: 'system' };

/**
 * The single place where order status changes. Uses compare-and-set on the current status so
 * two concurrent requests (e.g. a webhook and a redirect verification, or a double-clicked
 * button) cannot both apply a transition.
 */
@Injectable()
export class OrderStateService {
  /** Row-lock an order for the rest of the transaction (money-moving operations). */
  async lock(tx: Tx, orderId: string): Promise<Order> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Order not found');
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  async transition(
    tx: Tx,
    order: Pick<Order, 'id' | 'status'>,
    to: OrderStatus,
    actor: Actor,
    note?: string,
    data: Prisma.OrderUpdateManyMutationInput = {},
  ): Promise<void> {
    try {
      assertTransition(order.status, to);
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        throw new ConflictException({
          message: e.message,
          code: 'INVALID_TRANSITION',
          from: e.from,
          to: e.to,
        });
      }
      throw e;
    }
    const res = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { ...data, status: to },
    });
    if (res.count !== 1) {
      throw new ConflictException({
        message: 'Order was updated by another action. Refresh and try again.',
        code: 'STALE_ORDER',
      });
    }
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: to,
        actorUserId: actor.userId ?? null,
        actorType: actor.type,
        note,
      },
    });
    order.status = to;
  }
}
