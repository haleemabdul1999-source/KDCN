import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  DisputeStatus,
  FulfilmentMethod,
  FulfilmentStatus,
  MerchantSegment,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  SettlementStatus,
  StaffRole,
} from '@prisma/client';
import { z } from 'zod';
import { Auth, Staff } from '../../common/auth/decorators';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { pageArgs, parse, zId, zMinor, zPage, zPhone, zText } from '../../common/validation';
import { DisputesService } from '../disputes/disputes.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { RefundsService } from '../payments/refunds.service';

const ALL_STAFF = [StaffRole.OPERATIONS, StaffRole.SUPPORT, StaffRole.FINANCE];

@Controller('admin')
export class AdminOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly disputes: DisputesService,
    private readonly audit: AuditService,
  ) {}

  @Staff(...ALL_STAFF)
  @Get('orders')
  async list(@Query() query: unknown) {
    const q = parse(
      zPage.extend({
        status: z.nativeEnum(OrderStatus).optional(),
        segment: z.nativeEnum(MerchantSegment).optional(),
        q: z.string().max(60).optional(),
        merchantId: zId.optional(),
      }),
      query,
    );
    const where: Prisma.OrderWhereInput = {
      status: q.status ?? { not: OrderStatus.DRAFT },
      segment: q.segment,
      merchantId: q.merchantId,
      ...(q.q ? { number: { contains: q.q.toUpperCase() } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        select: {
          id: true,
          number: true,
          status: true,
          segment: true,
          totalMinor: true,
          fulfilmentMethod: true,
          createdAt: true,
          paidAt: true,
          merchant: { select: { id: true, displayName: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** Full order view for oversight; includes customer contact & address — access is audited. */
  @Staff(...ALL_STAFF)
  @Get('orders/:id')
  async get(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: KdcnRequest,
  ) {
    const o = await this.orders.detail({ id });
    await this.audit.record({
      actor: auth,
      action: 'admin.order_viewed',
      entityType: 'order',
      entityId: id,
      merchantId: o.merchantId,
      ip: req.ip,
    });
    const view = this.orders.merchantView(o);
    return {
      ...view,
      customer: {
        id: o.customer?.id ?? null,
        name: o.customer?.name ?? 'Guest',
        email: o.customer?.email ?? o.guestEmail,
        phone: o.customer?.phone ?? o.guestPhone,
      },
      merchantId: o.merchantId,
      segment: o.segment,
      commissionBps: o.commissionBps,
      commissionMinor: o.commissionMinor,
      settlement: o.settlement,
      payments: o.payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        provider: p.provider,
        status: p.status,
        amountMinor: p.amountMinor,
        providerFeeMinor: p.providerFeeMinor,
        providerTransactionId: p.providerTransactionId,
        isDuplicate: p.isDuplicate,
        testMode: p.isTestMode,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
      })),
      refunds: o.refunds,
      disputes: o.disputes,
      customerActions: this.orders.customerView(o).actions,
    };
  }

  @Staff(StaffRole.OPERATIONS, StaffRole.SUPPORT)
  @Post('orders/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const { reason } = parse(z.object({ reason: zText(300).min(5) }), body);
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException();
    const actor = { type: 'staff' as const, userId: auth.user.id };
    if (
      (
        [
          OrderStatus.PENDING_MERCHANT_CONFIRMATION,
          OrderStatus.AWAITING_PAYMENT,
          OrderStatus.PAYMENT_PENDING_VERIFICATION,
        ] as OrderStatus[]
      ).includes(o.status)
    ) {
      await this.orders.cancelUnpaid(id, actor, `Cancelled by KDCN: ${reason}`);
    } else {
      await this.orders.cancelPaid(id, actor, `Cancelled by KDCN: ${reason}`);
    }
    await this.audit.record({
      actor: auth,
      action: 'admin.order_cancelled',
      entityType: 'order',
      entityId: id,
      merchantId: o.merchantId,
      metadata: { reason },
      ip: req.ip,
    });
    return { ok: true };
  }

  // ── Payments & reconciliation ─────────────────────────────────────────

  @Staff(StaffRole.FINANCE)
  @Get('payments')
  async paymentsList(@Query() query: unknown) {
    const q = parse(
      zPage.extend({
        status: z.nativeEnum(PaymentStatus).optional(),
        duplicate: z.enum(['true', 'false']).optional(),
      }),
      query,
    );
    const where: Prisma.PaymentTransactionWhereInput = {
      status: q.status,
      ...(q.duplicate ? { isDuplicate: q.duplicate === 'true' } : {}),
    };
    const [items, total, summary] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: { order: { select: { id: true, number: true, status: true, totalMinor: true } } },
      }),
      this.prisma.paymentTransaction.count({ where }),
      this.prisma.paymentTransaction.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amountMinor: true, providerFeeMinor: true },
      }),
    ]);
    return { items: items.map((p) => ({ ...p, rawVerification: undefined })), total, summary };
  }

  /** Re-verify a payment with the provider (reconciliation). */
  @Staff(StaffRole.FINANCE)
  @Post('payments/:reference/reconcile')
  @HttpCode(200)
  async reconcile(
    @Auth() auth: AuthContext,
    @Param('reference') reference: string,
    @Req() req: KdcnRequest,
  ) {
    const outcome = await this.payments.verifyAndApply(reference, 'admin_reconcile');
    await this.audit.record({
      actor: auth,
      action: 'payment.reconciled',
      entityType: 'payment',
      entityId: reference,
      metadata: { outcome },
      ip: req.ip,
    });
    return { outcome };
  }

  @Staff(StaffRole.FINANCE)
  @Get('webhook-events')
  async webhooks(@Query() query: unknown) {
    const q = parse(zPage, query);
    const [items, total] = await Promise.all([
      this.prisma.providerWebhookEvent.findMany({
        orderBy: { receivedAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.providerWebhookEvent.count(),
    ]);
    return { items, total };
  }

  // ── Refunds ────────────────────────────────────────────────────────────

  @Staff(StaffRole.FINANCE, StaffRole.SUPPORT)
  @Get('refunds')
  async refundsList(@Query() query: unknown) {
    const q = parse(zPage.extend({ status: z.nativeEnum(RefundStatus).optional() }), query);
    const where = { status: q.status };
    const [items, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: {
          order: { select: { id: true, number: true, status: true } },
          paymentTransaction: { select: { reference: true, provider: true, isDuplicate: true } },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);
    return { items, total };
  }

  /** Staff-initiated (partial) refund outside a dispute, e.g. goodwill. Requires approval by finance. */
  @Staff(StaffRole.FINANCE, StaffRole.SUPPORT)
  @Post('orders/:id/refunds')
  async requestRefund(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const input = parse(
      z.object({
        amountMinor: zMinor.refine((v) => v > 0),
        reason: zText(300).min(5),
        idempotencyKey: z.string().min(8).max(80),
      }),
      body,
    );
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o || !o.paidAt) throw new BadRequestException('Order has not been paid');
    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await this.refunds.request(tx, {
        orderId: id,
        amountMinor: input.amountMinor,
        reason: input.reason,
        idempotencyKey: `staff:${input.idempotencyKey}`,
        requestedById: auth.user.id,
        autoApprove: false,
      });
      await this.audit.record(
        {
          actor: auth,
          action: 'refund.requested',
          entityType: 'refund',
          entityId: r.id,
          merchantId: o.merchantId,
          metadata: { orderId: id, amountMinor: input.amountMinor },
          ip: req.ip,
        },
        tx,
      );
      return r;
    });
    return refund;
  }

  @Staff(StaffRole.FINANCE)
  @Post('refunds/:id/:action')
  @HttpCode(200)
  async refundAction(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    if (action === 'approve') return this.refunds.approve(id, auth, req.ip);
    if (action === 'retry') return this.refunds.retry(id, auth, req.ip);
    if (action === 'reject') {
      const { reason } = parse(z.object({ reason: zText(300).min(3) }), body);
      await this.refunds.reject(id, auth, reason, req.ip);
      return this.prisma.refund.findUnique({ where: { id } });
    }
    throw new NotFoundException();
  }

  // ── Disputes ───────────────────────────────────────────────────────────

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Get('disputes')
  async disputesList(@Query() query: unknown) {
    const q = parse(
      zPage.extend({
        status: z.nativeEnum(DisputeStatus).optional(),
        open: z.enum(['true', 'false']).optional(),
      }),
      query,
    );
    const where: Prisma.DisputeWhereInput = q.status
      ? { status: q.status }
      : q.open === 'true'
        ? {
            status: {
              in: [DisputeStatus.OPEN, DisputeStatus.AWAITING_MERCHANT, DisputeStatus.UNDER_REVIEW],
            },
          }
        : {};
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        ...pageArgs(q),
        include: {
          order: {
            select: {
              id: true,
              number: true,
              totalMinor: true,
              merchant: { select: { displayName: true } },
            },
          },
        },
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items, total };
  }

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Get('disputes/:id')
  async dispute(@Param('id', ParseUUIDPipe) id: string) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        order: {
          select: { id: true, number: true, status: true, totalMinor: true, merchantId: true },
        },
      },
    });
    if (!d) throw new NotFoundException();
    return d;
  }

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Post('disputes/:id/messages')
  async disputeMessage(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { body: text } = parse(z.object({ body: zText(3000).min(1) }), body);
    return this.disputes.addMessage(id, auth.user.id, 'staff', text);
  }

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Post('disputes/:id/assign')
  @HttpCode(204)
  async assign(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const { assigneeId } = parse(z.object({ assigneeId: zId.optional() }), body ?? {});
    await this.disputes.assign(id, auth, assigneeId ?? auth.user.id, req.ip);
  }

  @Staff(StaffRole.SUPPORT)
  @Post('disputes/:id/resolve')
  @HttpCode(204)
  async resolve(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const r = parse(
      z.discriminatedUnion('outcome', [
        z.object({ outcome: z.literal('REFUND_FULL'), note: zText(1000).min(5) }),
        z.object({
          outcome: z.literal('REFUND_PARTIAL'),
          amountMinor: zMinor.refine((v) => v > 0),
          note: zText(1000).min(5),
        }),
        z.object({ outcome: z.literal('NO_REFUND'), note: zText(1000).min(5) }),
      ]),
      body,
    );
    await this.disputes.resolve(id, auth, r, req.ip);
  }

  // ── Settlements ────────────────────────────────────────────────────────

  @Staff(StaffRole.FINANCE)
  @Get('settlements')
  async settlements(@Query() query: unknown) {
    const q = parse(
      zPage.extend({
        status: z.nativeEnum(SettlementStatus).optional(),
        merchantId: zId.optional(),
      }),
      query,
    );
    const where = { status: q.status, merchantId: q.merchantId };
    const [items, total, byMerchant] = await Promise.all([
      this.prisma.settlementAllocation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: {
          order: { select: { number: true, status: true } },
          merchant: {
            select: { displayName: true, payoutBankCode: true, payoutAccountName: true },
          },
        },
      }),
      this.prisma.settlementAllocation.count({ where }),
      this.prisma.settlementAllocation.groupBy({
        by: ['merchantId'],
        where: { status: SettlementStatus.ELIGIBLE },
        _sum: { merchantNetMinor: true },
        _count: true,
      }),
    ]);
    return { items, total, eligibleByMerchant: byMerchant };
  }

  /** Record that a payout was made (manual transfer or confirmed provider settlement). */
  @Staff(StaffRole.FINANCE)
  @Post('settlements/mark-settled')
  @HttpCode(200)
  async markSettled(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(
      z.object({ settlementIds: z.array(zId).min(1).max(200), payoutReference: zText(100).min(3) }),
      body,
    );
    const res = await this.prisma.settlementAllocation.updateMany({
      where: { id: { in: input.settlementIds }, status: SettlementStatus.ELIGIBLE },
      data: {
        status: SettlementStatus.SETTLED,
        payoutReference: input.payoutReference,
        settledAt: new Date(),
      },
    });
    await this.audit.record({
      actor: auth,
      action: 'settlement.marked_settled',
      entityType: 'settlement',
      entityId: input.payoutReference,
      metadata: { count: res.count, ids: input.settlementIds },
      ip: req.ip,
    });
    if (res.count !== input.settlementIds.length) {
      throw new ConflictException(
        `${res.count} of ${input.settlementIds.length} settlements updated; the rest were not ELIGIBLE`,
      );
    }
    return { updated: res.count };
  }

  // ── Fulfilment monitoring & manual dispatch ───────────────────────────

  @Staff(StaffRole.OPERATIONS)
  @Get('fulfilments')
  async fulfilments(@Query() query: unknown) {
    const q = parse(
      zPage.extend({
        method: z.nativeEnum(FulfilmentMethod).optional(),
        status: z.nativeEnum(FulfilmentStatus).optional(),
      }),
      query,
    );
    const where: Prisma.FulfilmentWhereInput = {
      method: q.method,
      status: q.status ?? {
        notIn: [FulfilmentStatus.DELIVERED, FulfilmentStatus.COLLECTED, FulfilmentStatus.CANCELLED],
      },
      order: { paidAt: { not: null } },
    };
    const [items, total] = await Promise.all([
      this.prisma.fulfilment.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        ...pageArgs(q),
        include: {
          order: {
            select: {
              id: true,
              number: true,
              status: true,
              paidAt: true,
              merchant: { select: { displayName: true, contactPhone: true } },
            },
          },
          collectionPoint: { select: { name: true } },
          assignments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.fulfilment.count({ where }),
    ]);
    return {
      items: items.map((f) => ({
        ...f,
        deliveryAddressEnc: undefined,
        collectionCodeEnc: undefined,
      })),
      total,
    };
  }

  @Staff(StaffRole.OPERATIONS)
  @Post('orders/:id/fulfilment/:action')
  @HttpCode(200)
  async fulfilmentAction(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
  ) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException();
    const actor = { type: 'staff' as const, userId: auth.user.id };
    if (action === 'dispatch') {
      const input = parse(
        z.object({
          partnerName: zText(80).min(2),
          riderName: zText(80).optional(),
          riderPhone: zPhone.optional(),
          note: zText(300).optional(),
          logisticsCostMinor: zMinor.optional(),
        }),
        body,
      );
      if (o.status === OrderStatus.ACCEPTED_FOR_FULFILMENT)
        await this.orders.merchantPreparing(o, actor);
      await this.orders.dispatch(
        await this.prisma.order.findUniqueOrThrow({ where: { id } }),
        actor,
        input,
      );
    } else if (action === 'delivered') {
      await this.orders.markDelivered(
        o,
        actor,
        parse(z.object({ note: zText(300).optional() }), body ?? {}).note,
      );
    } else if (action === 'failed') {
      await this.orders.failedDelivery(
        o,
        actor,
        parse(z.object({ note: zText(300).min(3) }), body).note,
      );
    } else if (action === 'logistics-cost') {
      const { logisticsCostMinor } = parse(z.object({ logisticsCostMinor: zMinor }), body);
      await this.prisma.fulfilment.update({ where: { orderId: id }, data: { logisticsCostMinor } });
    } else {
      throw new NotFoundException();
    }
    return this.orders.merchantView(await this.orders.detail({ id }));
  }
}
