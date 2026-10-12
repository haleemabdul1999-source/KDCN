import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DisputeStatus, OrderStatus, ReviewStatus } from '@prisma/client';
import { DISPUTE_WINDOW_DAYS } from '../../config/constants';
import { AuditService } from '../../common/audit.service';
import { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { Actor, OrderStateService } from '../orders/order-state.service';
import { DISPUTABLE } from '../orders/order-state-machine';
import { RefundsService } from '../payments/refunds.service';
import { SettlementsService } from '../settlements/settlements.service';

export const OPEN_DISPUTE: DisputeStatus[] = [DisputeStatus.OPEN, DisputeStatus.AWAITING_MERCHANT, DisputeStatus.UNDER_REVIEW];

export type Resolution =
  | { outcome: 'REFUND_FULL'; note: string }
  | { outcome: 'REFUND_PARTIAL'; amountMinor: number; note: string }
  | { outcome: 'NO_REFUND'; note: string };

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderState: OrderStateService,
    private readonly refunds: RefundsService,
    private readonly settlements: SettlementsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async open(orderId: string, actor: Actor & { userId: string }, reason: string, description: string) {
    return this.prisma.$transaction(async (tx) => {
      const o = await this.orderState.lock(tx, orderId);
      if (!DISPUTABLE.includes(o.status)) throw new ConflictException('A dispute cannot be opened for this order at its current stage');
      if (o.status === OrderStatus.COMPLETED && o.completedAt && Date.now() - o.completedAt.getTime() > DISPUTE_WINDOW_DAYS * 86400_000) {
        throw new ConflictException(`Disputes must be opened within ${DISPUTE_WINDOW_DAYS} days of completion`);
      }
      const prior = o.status;
      await this.orderState.transition(tx, o, OrderStatus.DISPUTED, actor, `Dispute opened: ${reason}`);
      const d = await tx.dispute.create({
        data: { orderId, openedById: actor.userId, reason, description, status: DisputeStatus.AWAITING_MERCHANT, priorOrderStatus: prior },
      });
      await tx.disputeMessage.create({ data: { disputeId: d.id, authorId: actor.userId, authorRole: 'customer', body: description } });
      await this.settlements.hold(tx, orderId);
      await this.audit.record({ action: 'dispute.opened', entityType: 'dispute', entityId: d.id, merchantId: o.merchantId, metadata: { orderId, reason } }, tx);
      const members = await tx.merchantMember.findMany({ where: { merchantId: o.merchantId }, include: { user: true } });
      for (const m of members) {
        await this.notifications.enqueue({ userId: m.userId, email: m.user.email, template: 'merchant.dispute_opened', subject: `Dispute opened on order ${o.number}`, body: `Reason: ${reason}. Please respond with your account of events.`, data: { orderId, disputeId: d.id } }, tx);
      }
      return d;
    });
  }

  async addMessage(disputeId: string, authorId: string, authorRole: 'customer' | 'merchant' | 'staff', body: string, evidenceKeys: string[] = []) {
    const d = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!d) throw new NotFoundException('Dispute not found');
    if (!OPEN_DISPUTE.includes(d.status)) throw new ConflictException('This dispute is closed');
    const msg = await this.prisma.disputeMessage.create({ data: { disputeId, authorId, authorRole, body, evidenceKeys } });
    if (authorRole === 'merchant' && d.status === DisputeStatus.AWAITING_MERCHANT) {
      await this.prisma.dispute.update({ where: { id: disputeId }, data: { status: DisputeStatus.UNDER_REVIEW } });
    }
    return msg;
  }

  async assign(disputeId: string, staff: AuthContext, assigneeId: string, ip?: string) {
    const assignee = await this.prisma.user.findUnique({ where: { id: assigneeId } });
    if (!assignee || assignee.staffRoles.length === 0) throw new BadRequestException('Assignee must be KDCN staff');
    const res = await this.prisma.dispute.updateMany({ where: { id: disputeId, status: { in: OPEN_DISPUTE } }, data: { assignedToId: assigneeId, status: DisputeStatus.UNDER_REVIEW } });
    if (!res.count) throw new ConflictException('Dispute is not open');
    await this.audit.record({ actor: staff, action: 'dispute.assigned', entityType: 'dispute', entityId: disputeId, metadata: { assigneeId }, ip });
  }

  async resolve(disputeId: string, staff: AuthContext, r: Resolution, ip?: string) {
    const actor: Actor = { type: 'staff', userId: staff.user.id };
    const refundId = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!d) throw new NotFoundException('Dispute not found');
      const o = await this.orderState.lock(tx, d.orderId);
      const claimed = await tx.dispute.updateMany({
        where: { id: disputeId, status: { in: OPEN_DISPUTE } },
        data: {
          status: r.outcome === 'NO_REFUND' ? DisputeStatus.RESOLVED_NO_REFUND : DisputeStatus.RESOLVED_REFUND,
          resolution: r.note,
          resolvedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new ConflictException('Dispute already resolved');
      let refundId: string | null = null;
      if (r.outcome === 'REFUND_FULL') {
        await this.orderState.transition(tx, o, OrderStatus.REFUND_PENDING, actor, `Dispute resolved: full refund. ${r.note}`);
        const refund = await this.refunds.refundWholeOrder(tx, o.id, `Dispute resolution: ${r.note}`, actor, `dispute:${disputeId}`);
        refundId = refund.id;
      } else {
        // Partial refund or no refund: the order returns to its prior state, or completes if it
        // had already been delivered.
        const delivered = ([OrderStatus.DELIVERED, OrderStatus.COMPLETED] as OrderStatus[]).includes(d.priorOrderStatus);
        const target = delivered ? OrderStatus.COMPLETED : d.priorOrderStatus;
        await this.orderState.transition(tx, o, target, actor, `Dispute resolved: ${r.outcome === 'NO_REFUND' ? 'no refund' : 'partial refund'}. ${r.note}`, delivered ? { completedAt: o.completedAt ?? new Date() } : {});
        await this.settlements.releaseHold(tx, o.id, delivered);
        if (r.outcome === 'REFUND_PARTIAL') {
          const refund = await this.refunds.request(tx, {
            orderId: o.id,
            amountMinor: r.amountMinor,
            reason: `Dispute resolution (partial): ${r.note}`,
            idempotencyKey: `dispute:${disputeId}`,
            requestedById: staff.user.id,
            autoApprove: true,
            disputeId,
          });
          refundId = refund.id;
        }
      }
      await tx.refund.updateMany({ where: { id: refundId ?? '' }, data: { disputeId } });
      await this.audit.record({ actor: staff, action: 'dispute.resolved', entityType: 'dispute', entityId: disputeId, merchantId: o.merchantId, metadata: { ...r }, ip }, tx);
      const user = o.customerId ? await tx.user.findUnique({ where: { id: o.customerId } }) : null;
      await this.notifications.enqueue({ userId: o.customerId, email: user?.email ?? o.guestEmail, template: 'dispute.resolved', subject: `Your dispute on order ${o.number} has been resolved`, body: r.note, data: { orderId: o.id } }, tx);
      return refundId;
    });
    if (refundId) await this.refunds.process(refundId);
  }
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Reviews are tied to a genuine delivered/completed order owned by the reviewer. */
  async create(orderId: string, customerId: string, rating: number, body: string) {
    const o = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!o) throw new NotFoundException('Order not found');
    if (!([OrderStatus.DELIVERED, OrderStatus.COMPLETED] as OrderStatus[]).includes(o.status)) {
      throw new ConflictException('You can review an order once it has been delivered or collected');
    }
    try {
      return await this.prisma.review.create({ data: { orderId, merchantId: o.merchantId, customerId, rating, body } });
    } catch {
      throw new ConflictException('You have already reviewed this order');
    }
  }

  /** Merchants may respond once; they cannot edit or delete the review. */
  async respond(reviewId: string, merchantId: string, response: string) {
    const res = await this.prisma.review.updateMany({ where: { id: reviewId, merchantId, merchantResponse: null }, data: { merchantResponse: response, respondedAt: new Date() } });
    if (!res.count) throw new ConflictException('Review not found or already responded to');
  }

  async moderate(reviewId: string, staff: AuthContext, status: ReviewStatus, reason: string, ip?: string) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException();
    await this.prisma.review.update({ where: { id: reviewId }, data: { status } });
    await this.audit.record({ actor: staff, action: 'review.moderated', entityType: 'review', entityId: reviewId, merchantId: r.merchantId, metadata: { from: r.status, to: status, reason }, ip });
  }
}
