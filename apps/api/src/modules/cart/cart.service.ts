import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomToken, sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { availabilityFor } from '../catalog/availability';
import { VISIBLE_LISTING_WHERE } from '../catalog/listing-card.service';
import { mediaUrl } from '../merchants/merchant-public';

export interface CartOwner {
  userId?: string;
  guestToken?: string;
}

const ITEM_INCLUDE = {
  listingVariant: {
    include: {
      inventory: true,
      productVariant: true,
      listing: {
        include: {
          product: { include: { images: { orderBy: { sortOrder: 'asc' as const }, take: 1 } } },
          merchant: { select: { id: true, slug: true, displayName: true, type: true, status: true } },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

const MAX_CART_LINES = 50;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async findCart(owner: CartOwner) {
    if (owner.userId) return this.prisma.cart.findFirst({ where: { userId: owner.userId }, orderBy: { createdAt: 'asc' } });
    if (owner.guestToken) return this.prisma.cart.findUnique({ where: { guestTokenHash: sha256(owner.guestToken) } });
    return null;
  }

  /** Returns the cart, creating it if needed. For guests, may mint a new token to set as cookie. */
  async ensureCart(owner: CartOwner): Promise<{ cartId: string; newGuestToken?: string }> {
    const existing = await this.findCart(owner);
    if (existing) return { cartId: existing.id };
    if (owner.userId) {
      const c = await this.prisma.cart.create({ data: { userId: owner.userId } });
      return { cartId: c.id };
    }
    const token = randomToken(24);
    const c = await this.prisma.cart.create({ data: { guestTokenHash: sha256(token) } });
    return { cartId: c.id, newGuestToken: token };
  }

  async addItem(cartId: string, listingVariantId: string, quantity: number) {
    const lv = await this.prisma.listingVariant.findFirst({
      where: { id: listingVariantId, active: true, listing: VISIBLE_LISTING_WHERE },
      include: { listing: true, inventory: true },
    });
    if (!lv) throw new NotFoundException('This item is no longer available');
    const existing = await this.prisma.cartItem.findUnique({ where: { cartId_listingVariantId: { cartId, listingVariantId } } });
    const newQty = (existing?.quantity ?? 0) + quantity;
    this.checkQuantity(lv.listing, newQty);
    const avail = availabilityFor(lv.listing.stockMode, lv.listing.leadTimeDays, lv.inventory);
    if (!avail.purchasable) throw new BadRequestException('This item is out of stock');
    if (!existing && (await this.prisma.cartItem.count({ where: { cartId } })) >= MAX_CART_LINES) {
      throw new BadRequestException('Your cart is full');
    }
    await this.prisma.cartItem.upsert({
      where: { cartId_listingVariantId: { cartId, listingVariantId } },
      create: { cartId, listingVariantId, quantity: newQty },
      update: { quantity: newQty },
    });
  }

  async setQuantity(cartId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId }, include: { listingVariant: { include: { listing: true } } } });
    if (!item) throw new NotFoundException('Cart item not found');
    this.checkQuantity(item.listingVariant.listing, quantity);
    await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  }

  async removeItem(cartId: string, itemId: string) {
    await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
  }

  private checkQuantity(listing: { minOrderQty: number; maxOrderQty: number }, qty: number) {
    if (qty < listing.minOrderQty) throw new BadRequestException(`Minimum order quantity is ${listing.minOrderQty}`);
    if (qty > listing.maxOrderQty) throw new BadRequestException(`Maximum order quantity is ${listing.maxOrderQty}`);
  }

  /** Cart view grouped by merchant, with live price and availability checks. */
  async view(cartId: string | undefined) {
    if (!cartId) return { groups: [], itemCount: 0 };
    const items = await this.prisma.cartItem.findMany({ where: { cartId }, include: ITEM_INCLUDE, orderBy: { addedAt: 'asc' } });
    const groups = new Map<string, { merchant: { id: string; slug: string; displayName: string; type: string }; items: unknown[]; subtotalMinor: number; checkoutable: boolean; requiresConfirmation: boolean }>();
    for (const it of items) {
      const lv = it.listingVariant;
      const l = lv.listing;
      const availability = availabilityFor(l.stockMode, l.leadTimeDays, lv.inventory);
      const issues: string[] = [];
      if (l.status !== 'ACTIVE' || l.merchant.status !== 'APPROVED' || !lv.active) issues.push('No longer available');
      else if (!availability.purchasable) issues.push('Out of stock');
      else if (availability.quantityHint !== undefined && it.quantity > availability.quantityHint) issues.push(`Only ${availability.quantityHint} available`);
      if (it.quantity < l.minOrderQty || it.quantity > l.maxOrderQty) issues.push(`Quantity must be between ${l.minOrderQty} and ${l.maxOrderQty}`);
      const g = groups.get(l.merchant.id) ?? {
        merchant: { id: l.merchant.id, slug: l.merchant.slug, displayName: l.merchant.displayName, type: l.merchant.type },
        items: [],
        subtotalMinor: 0,
        checkoutable: true,
        requiresConfirmation: false,
      };
      const line = lv.priceMinor * it.quantity;
      g.items.push({
        id: it.id,
        listingVariantId: lv.id,
        listingSlug: l.slug,
        title: l.product.title,
        variantName: lv.productVariant.name,
        imageUrl: mediaUrl(l.product.images[0]?.storageKey),
        unitPriceMinor: lv.priceMinor,
        quantity: it.quantity,
        lineTotalMinor: line,
        stockMode: l.stockMode,
        availability,
        issues,
      });
      g.subtotalMinor += line;
      if (issues.length) g.checkoutable = false;
      if (l.stockMode !== 'TRACKED') g.requiresConfirmation = true;
      groups.set(l.merchant.id, g);
    }
    return { groups: [...groups.values()], itemCount: items.reduce((n, i) => n + i.quantity, 0) };
  }

  /** On sign-in, move guest cart lines into the user's cart. */
  async mergeGuestCart(guestToken: string, userId: string) {
    const guest = await this.prisma.cart.findUnique({ where: { guestTokenHash: sha256(guestToken) }, include: { items: true } });
    if (!guest || guest.items.length === 0) return;
    const { cartId } = await this.ensureCart({ userId });
    for (const item of guest.items) {
      await this.prisma.cartItem.upsert({
        where: { cartId_listingVariantId: { cartId, listingVariantId: item.listingVariantId } },
        create: { cartId, listingVariantId: item.listingVariantId, quantity: item.quantity },
        update: {},
      });
    }
    await this.prisma.cart.delete({ where: { id: guest.id } });
  }
}
