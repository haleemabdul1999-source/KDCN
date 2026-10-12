import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { env } from '../../config/env';
import { CurrentAuth, Public } from '../../common/auth/decorators';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { parse } from '../../common/validation';
import { CartService } from '../cart/cart.service';
import { cartOwner } from '../cart/cart.controller';
import { OrdersService } from '../orders/orders.service';
import { checkoutSchema, CheckoutService } from './checkout.service';

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly carts: CartService,
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('quote')
  @HttpCode(200)
  async quote(@Req() req: KdcnRequest, @Body() body: unknown, @CurrentAuth() auth?: AuthContext) {
    const input = parse(
      checkoutSchema.partial({ fulfilmentMethod: true }).required({ merchantId: true }),
      body,
    );
    const cart = await this.carts.findCart(cartOwner(req, auth));
    if (!input.fulfilmentMethod) {
      // Without a method, return the available options for this merchant.
      const m = await this.prisma.merchant.findUnique({
        where: { id: input.merchantId },
        select: {
          fulfilmentOpts: {
            where: { enabled: true },
            select: {
              method: true,
              feeMinor: true,
              instructions: true,
              collectionPoint: {
                select: { id: true, name: true, publicAddress: true, openingHours: true },
              },
            },
          },
          serviceAreas: {
            select: {
              deliveryFeeMinor: true,
              etaDays: true,
              area: { select: { id: true, name: true } },
            },
          },
          locations: {
            where: { kind: 'PUBLIC_STORE' },
            select: { label: true, publicAddress: true, unitLabel: true },
          },
        },
      });
      return {
        options: m?.fulfilmentOpts ?? [],
        deliveryAreas: m?.serviceAreas ?? [],
        storeLocations: m?.locations ?? [],
      };
    }
    const { quote } = await this.checkout.quote(
      cart?.id,
      input as Parameters<CheckoutService['quote']>[1],
    );
    return quote;
  }

  @Public()
  @Throttle({ default: { limit: env().CHECKOUT_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } })
  @Post('place')
  async place(
    @Req() req: KdcnRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') idem: string | undefined,
    @CurrentAuth() auth?: AuthContext,
  ) {
    const input = parse(checkoutSchema, body);
    const cart = await this.carts.findCart(cartOwner(req, auth));
    const result = await this.checkout.place(cart?.id, input, idem ?? '', auth?.user.id, req.ip);
    const order = await this.orders.detail({ id: result.orderId });
    return {
      order: this.orders.customerView(order),
      guestAccessToken: result.replayed ? undefined : result.guestAccessToken,
      replayed: result.replayed,
    };
  }
}
