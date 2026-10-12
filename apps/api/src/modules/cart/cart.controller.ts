import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { cookieSecure } from '../../config/env';
import { CurrentAuth, Public } from '../../common/auth/decorators';
import { AuthContext, GUEST_CART_COOKIE, KdcnRequest } from '../../common/auth/auth.types';
import { parse, zId } from '../../common/validation';
import { CartOwner, CartService } from './cart.service';

export function cartOwner(req: KdcnRequest, auth?: AuthContext): CartOwner {
  if (auth) return { userId: auth.user.id };
  return { guestToken: (req.cookies as Record<string, string> | undefined)?.[GUEST_CART_COOKIE] };
}

@Controller('cart')
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Public()
  @Get()
  async get(@Req() req: KdcnRequest, @CurrentAuth() auth?: AuthContext) {
    const cart = await this.carts.findCart(cartOwner(req, auth));
    return this.carts.view(cart?.id);
  }

  @Public()
  @Post('items')
  async add(@Req() req: KdcnRequest, @Res({ passthrough: true }) res: Response, @Body() body: unknown, @CurrentAuth() auth?: AuthContext) {
    const input = parse(z.object({ listingVariantId: zId, quantity: z.number().int().min(1).max(10_000) }), body);
    const { cartId, newGuestToken } = await this.carts.ensureCart(cartOwner(req, auth));
    if (newGuestToken) {
      res.cookie(GUEST_CART_COOKIE, newGuestToken, { httpOnly: true, secure: cookieSecure(), sameSite: 'lax', path: '/', maxAge: 30 * 86400_000 });
    }
    await this.carts.addItem(cartId, input.listingVariantId, input.quantity);
    return this.carts.view(cartId);
  }

  @Public()
  @Patch('items/:itemId')
  async update(@Req() req: KdcnRequest, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @CurrentAuth() auth?: AuthContext) {
    const { quantity } = parse(z.object({ quantity: z.number().int().min(1).max(10_000) }), body);
    const cart = await this.carts.findCart(cartOwner(req, auth));
    if (cart) await this.carts.setQuantity(cart.id, itemId, quantity);
    return this.carts.view(cart?.id);
  }

  @Public()
  @Delete('items/:itemId')
  async remove(@Req() req: KdcnRequest, @Param('itemId', ParseUUIDPipe) itemId: string, @CurrentAuth() auth?: AuthContext) {
    const cart = await this.carts.findCart(cartOwner(req, auth));
    if (cart) await this.carts.removeItem(cart.id, itemId);
    return this.carts.view(cart?.id);
  }
}
