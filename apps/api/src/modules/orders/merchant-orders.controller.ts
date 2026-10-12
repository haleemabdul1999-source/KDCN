import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { MerchantRole, OrderStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { Auth } from '../../common/auth/decorators';
import { AccessService } from '../../common/auth/access.service';
import { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { pageArgs, parse, zMinor, zPhone, zText } from '../../common/validation';
import { DisputesService, ReviewsService } from '../disputes/disputes.service';
import { OrdersService } from './orders.service';

/**
 * Merchant order management. Every query is scoped by the merchantId the caller is a member of
 * (object-level authorisation): changing the order id to another merchant's order returns 404.
 */
@Controller('merchant/:merchantId')
export class MerchantOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly orders: OrdersService,
    private readonly disputes: DisputesService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('orders')
  async list(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Query() query: unknown) {
    await this.access.requireMerchant(auth, merchantId);
    const q = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
        status: z.nativeEnum(OrderStatus).optional(),
        bucket: z.enum(['action', 'active', 'done', 'all']).default('all'),
      }),
      query,
    );
    const buckets: Record<string, OrderStatus[]> = {
      action: [OrderStatus.PENDING_MERCHANT_CONFIRMATION, OrderStatus.PAID, OrderStatus.DISPUTED],
      active: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_PENDING_VERIFICATION, OrderStatus.ACCEPTED_FOR_FULFILMENT, OrderStatus.PREPARING, OrderStatus.READY_FOR_COLLECTION, OrderStatus.DISPATCHED, OrderStatus.DELIVERED],
      done: [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.REFUND_PENDING],
    };
    const where: Prisma.OrderWhereInput = {
      merchantId,
      status: q.status ?? (q.bucket === 'all' ? { not: OrderStatus.DRAFT } : { in: buckets[q.bucket] }),
    };
    const [rows, total, counts] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { items: true } }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({ by: ['status'], where: { merchantId }, _count: true }),
    ]);
    return {
      items: rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        totalMinor: o.totalMinor,
        subtotalMinor: o.subtotalMinor,
        fulfilmentMethod: o.fulfilmentMethod,
        createdAt: o.createdAt,
        confirmationDeadline: o.confirmationDeadline,
        items: o.items.map((i) => ({ title: i.productTitle, variantName: i.variantName, quantity: i.quantity })),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  @Get('orders/:orderId')
  async get(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Param('orderId', ParseUUIDPipe) orderId: string) {
    await this.access.requireMerchant(auth, merchantId);
    return this.orders.merchantView(await this.orders.detail({ id: orderId, merchantId }));
  }

  @Post('orders/:orderId/:action')
  @HttpCode(200)
  async act(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('action') action: string,
    @Body() body: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, merchantId } });
    if (!order) throw new NotFoundException('Order not found');
    const actor = { type: 'merchant' as const, userId: auth.user.id };
    const b = body ?? {};
    switch (action) {
      case 'confirm':
        await this.orders.merchantConfirm(order, actor, parse(z.object({ note: zText(500).optional() }), b).note);
        break;
      case 'reject':
        await this.orders.merchantReject(order, actor, parse(z.object({ reason: zText(300).min(3) }), b).reason);
        break;
      case 'accept':
        await this.orders.merchantAccept(order, actor);
        break;
      case 'preparing':
        await this.orders.merchantPreparing(order, actor);
        break;
      case 'ready':
        await this.orders.merchantReady(order, actor);
        break;
      case 'dispatch':
        await this.orders.dispatch(
          order,
          actor,
          parse(z.object({ partnerName: zText(80).min(2), riderName: zText(80).optional(), riderPhone: zPhone.optional(), note: zText(300).optional(), logisticsCostMinor: zMinor.optional() }), b),
        );
        break;
      case 'delivered':
        await this.orders.markDelivered(order, actor, parse(z.object({ note: zText(300).optional() }), b).note);
        break;
      case 'collected':
        await this.orders.verifyCollection(order, actor, parse(z.object({ code: z.string().regex(/^\d{6}$/, 'enter the 6-digit code') }), b).code);
        break;
      case 'delivery-failed':
        await this.orders.failedDelivery(order, actor, parse(z.object({ note: zText(300).min(3) }), b).note);
        break;
      case 'cancel': {
        await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
        const { reason } = parse(z.object({ reason: zText(300).min(3) }), b);
        await this.orders.cancelPaid(order.id, actor, `Cancelled by seller: ${reason}`);
        break;
      }
      default:
        throw new NotFoundException('Unknown action');
    }
    return this.orders.merchantView(await this.orders.detail({ id: orderId, merchantId }));
  }

  @Post('disputes/:disputeId/messages')
  async disputeMessage(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Param('disputeId', ParseUUIDPipe) disputeId: string, @Body() body: unknown) {
    await this.access.requireMerchant(auth, merchantId);
    const d = await this.prisma.dispute.findFirst({ where: { id: disputeId, order: { merchantId } } });
    if (!d) throw new NotFoundException();
    const { body: text } = parse(z.object({ body: zText(3000).min(1) }), body);
    await this.disputes.addMessage(d.id, auth.user.id, 'merchant', text);
    return this.orders.merchantView(await this.orders.detail({ id: d.orderId, merchantId }));
  }

  @Get('disputes')
  async disputesList(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string) {
    await this.access.requireMerchant(auth, merchantId);
    return this.prisma.dispute.findMany({
      where: { order: { merchantId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, status: true, reason: true, createdAt: true, resolution: true, order: { select: { id: true, number: true, totalMinor: true } } },
    });
  }

  @Get('reviews')
  async reviewsList(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string) {
    await this.access.requireMerchant(auth, merchantId);
    return this.prisma.review.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, rating: true, body: true, status: true, merchantResponse: true, createdAt: true, order: { select: { number: true } } },
    });
  }

  @Post('reviews/:reviewId/respond')
  @HttpCode(204)
  async respond(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Param('reviewId', ParseUUIDPipe) reviewId: string, @Body() body: unknown) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const { response } = parse(z.object({ response: zText(1000).min(2) }), body);
    await this.reviews.respond(reviewId, merchantId, response);
  }

  @Get('settlements')
  async settlements(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Query() query: unknown) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }), query);
    const where = { merchantId };
    const [items, total, sums] = await Promise.all([
      this.prisma.settlementAllocation.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { order: { select: { number: true, status: true, paidAt: true } } } }),
      this.prisma.settlementAllocation.count({ where }),
      this.prisma.settlementAllocation.groupBy({ by: ['status'], where, _sum: { merchantNetMinor: true, grossMinor: true, commissionMinor: true } }),
    ]);
    return {
      items: items.map((s) => ({
        id: s.id,
        orderNumber: s.order.number,
        orderStatus: s.order.status,
        paidAt: s.order.paidAt,
        grossMinor: s.grossMinor,
        commissionMinor: s.commissionMinor,
        merchantDeliveryMinor: s.merchantDeliveryMinor,
        refundedMinor: s.refundedMinor,
        merchantNetMinor: s.merchantNetMinor,
        status: s.status,
        mode: s.mode,
        payoutReference: s.payoutReference,
        settledAt: s.settledAt,
      })),
      total,
      totalsByStatus: sums.map((s) => ({ status: s.status, merchantNetMinor: s._sum.merchantNetMinor ?? 0, grossMinor: s._sum.grossMinor ?? 0, commissionMinor: s._sum.commissionMinor ?? 0 })),
    };
  }
}
