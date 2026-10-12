import {
  BadRequestException,
  Body,
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
import { Order } from '@prisma/client';
import { z } from 'zod';
import { Auth, CurrentAuth, Public } from '../../common/auth/decorators';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { pageArgs, parse, zPage, zText } from '../../common/validation';
import { DisputesService, ReviewsService } from '../disputes/disputes.service';
import { PaymentsService } from '../payments/payments.service';
import { Actor } from './order-state.service';
import { OrdersService } from './orders.service';

export const ORDER_TOKEN_HEADER = 'x-kdcn-order-token';

/** Customer (and guest) order endpoints. Every lookup is scoped to the caller. */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly disputes: DisputesService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get()
  async mine(@Auth() auth: AuthContext, @Query() query: unknown) {
    const q = parse(zPage, query);
    const where = { customerId: auth.user.id };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: { items: { take: 3 } },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        totalMinor: o.totalMinor,
        createdAt: o.createdAt,
        merchant: o.merchantSnapshot,
        itemTitles: o.items.map((i) => i.productTitle),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Guest tracking: order number + access token. */
  @Public()
  @Post('track')
  @HttpCode(200)
  async track(@Body() body: unknown) {
    const { number, token } = parse(
      z.object({ number: z.string().max(30), token: z.string().min(10).max(100) }),
      body,
    );
    const o = await this.prisma.order.findUnique({
      where: { number: number.trim().toUpperCase() },
    });
    if (!o || !o.guestAccessHash || o.guestAccessHash !== sha256(token))
      throw new NotFoundException('Order not found');
    return this.orders.customerView(await this.orders.detail({ id: o.id }));
  }

  @Public()
  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: KdcnRequest,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const o = await this.resolve(id, req, auth);
    return this.orders.customerView(await this.orders.detail({ id: o.id }));
  }

  @Public()
  @Post(':id/pay')
  @HttpCode(200)
  async pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: KdcnRequest,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const o = await this.resolve(id, req, auth);
    return this.payments.initiate(o.id, this.actor(auth));
  }

  /**
   * Called by the payment return page. Performs server-side verification with the provider;
   * the redirect itself proves nothing.
   */
  @Public()
  @Post(':id/verify-payment')
  @HttpCode(200)
  async verifyPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const o = await this.resolve(id, req, auth);
    const { reference } = parse(z.object({ reference: z.string().max(100) }), body);
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: { reference, orderId: o.id },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    let outcome: string;
    try {
      outcome = await this.payments.verifyAndApply(reference, 'customer_return');
    } catch {
      outcome = 'verification_unavailable';
    }
    return { outcome, order: this.orders.customerView(await this.orders.detail({ id: o.id })) };
  }

  @Public()
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const o = await this.resolve(id, req, auth);
    const { reason } = parse(z.object({ reason: zText(300).default('') }), body ?? {});
    await this.orders.customerCancel(o, this.actor(auth), reason);
    return this.orders.customerView(await this.orders.detail({ id: o.id }));
  }

  @Public()
  @Post(':id/confirm-receipt')
  @HttpCode(200)
  async confirmReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: KdcnRequest,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const o = await this.resolve(id, req, auth);
    await this.orders.confirmReceipt(o, this.actor(auth));
    return this.orders.customerView(await this.orders.detail({ id: o.id }));
  }

  @Post(':id/disputes')
  async openDispute(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const o = await this.ownOrder(id, auth);
    const input = parse(
      z.object({
        reason: z.enum([
          'not_received',
          'not_as_described',
          'damaged',
          'wrong_item',
          'cancellation_request',
          'other',
        ]),
        description: zText(3000).min(10),
      }),
      body,
    );
    await this.disputes.open(
      o.id,
      { type: 'customer', userId: auth.user.id },
      input.reason,
      input.description,
    );
    return this.orders.customerView(await this.orders.detail({ id: o.id }));
  }

  @Post(':id/disputes/:disputeId/messages')
  async disputeMessage(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() body: unknown,
  ) {
    const o = await this.ownOrder(id, auth);
    const d = await this.prisma.dispute.findFirst({ where: { id: disputeId, orderId: o.id } });
    if (!d) throw new NotFoundException();
    const { body: text } = parse(z.object({ body: zText(3000).min(1) }), body);
    await this.disputes.addMessage(d.id, auth.user.id, 'customer', text);
    return this.orders.customerView(await this.orders.detail({ id: o.id }));
  }

  @Post(':id/review')
  async review(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({ rating: z.number().int().min(1).max(5), body: zText(2000).default('') }),
      body,
    );
    await this.reviews.create(id, auth.user.id, input.rating, input.body);
    return this.orders.customerView(await this.orders.detail({ id, customerId: auth.user.id }));
  }

  private actor(auth?: AuthContext): Actor {
    return { type: 'customer', userId: auth?.user.id ?? null };
  }

  private async ownOrder(id: string, auth: AuthContext): Promise<Order> {
    const o = await this.prisma.order.findFirst({ where: { id, customerId: auth.user.id } });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  /** Signed-in owner, or a guest presenting the order access token. */
  private async resolve(id: string, req: KdcnRequest, auth?: AuthContext): Promise<Order> {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Order not found');
    if (auth && o.customerId === auth.user.id) return o;
    const token = req.headers[ORDER_TOKEN_HEADER];
    if (typeof token === 'string' && o.guestAccessHash && o.guestAccessHash === sha256(token))
      return o;
    if (!auth && !token) throw new BadRequestException('Sign in to view this order');
    throw new NotFoundException('Order not found');
  }
}
