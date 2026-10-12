import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FulfilmentMethod, MerchantStatus, OrderStatus, Prisma, StockMode } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit.service';
import { encryptField, randomToken, sha256 } from '../../common/crypto';
import { applyBps, MAX_AMOUNT_MINOR } from '../../common/money';
import { PrismaService } from '../../common/prisma.service';
import { zId, zPhone, zText } from '../../common/validation';
import { availabilityFor } from '../catalog/availability';
import { VISIBLE_LISTING_WHERE } from '../catalog/listing-card.service';
import { segmentFor } from '../merchants/merchant-public';
import { NotificationService } from '../notifications/notification.service';
import { InventoryService } from '../orders/inventory.service';
import { OrderStateService } from '../orders/order-state.service';
import { CommissionService } from '../settlements/commission.service';

export const checkoutSchema = z.object({
  merchantId: zId,
  fulfilmentMethod: z.nativeEnum(FulfilmentMethod),
  collectionPointId: zId.optional(),
  deliveryAreaId: zId.optional(),
  deliveryAddress: zText(300).optional(),
  recipientPhone: zPhone.optional(),
  customerNote: zText(500).optional(),
  guestEmail: z.string().trim().toLowerCase().email().optional(),
  guestPhone: zPhone.optional(),
  guestName: zText(100).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the refund and cancellation terms' }) }).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

interface Line {
  listingVariantId: string;
  listingId: string;
  title: string;
  variantName: string;
  unitPriceMinor: number;
  quantity: number;
  stockMode: StockMode;
  leadTimeDays: number;
}

/**
 * Release 1 checkout is single-merchant: one order per merchant from the cart. The cart and
 * order models already allow multi-merchant baskets, which stay disabled until split
 * fulfilment and settlement are operationally validated (Release 3).
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commission: CommissionService,
    private readonly inventory: InventoryService,
    private readonly orderState: OrderStateService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async quote(cartId: string | undefined, input: CheckoutInput) {
    if (!cartId) throw new BadRequestException('Your cart is empty');
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: input.merchantId },
      include: {
        fulfilmentOpts: { where: { enabled: true }, include: { collectionPoint: true } },
        serviceAreas: { include: { area: true } },
        affiliations: { where: { status: 'APPROVED' }, include: { market: true } },
        locations: { where: { kind: 'PUBLIC_STORE' }, include: { area: true } },
      },
    });
    if (!merchant || merchant.status !== MerchantStatus.APPROVED) throw new BadRequestException('This seller is not currently accepting orders');

    const items = await this.prisma.cartItem.findMany({
      where: { cartId, listingVariant: { listing: { merchantId: merchant.id } } },
      include: { listingVariant: { include: { inventory: true, productVariant: true, listing: { include: { product: true } } } } },
      orderBy: { addedAt: 'asc' },
    });
    if (!items.length) throw new BadRequestException('No items from this seller in your cart');

    const lines: Line[] = [];
    for (const it of items) {
      const lv = it.listingVariant;
      const l = lv.listing;
      const visible = await this.prisma.listing.count({ where: { id: l.id, ...VISIBLE_LISTING_WHERE } });
      if (!visible || !lv.active) throw new ConflictException({ message: `"${l.product.title}" is no longer available`, code: 'UNAVAILABLE' });
      const av = availabilityFor(l.stockMode, l.leadTimeDays, lv.inventory);
      if (!av.purchasable) throw new ConflictException({ message: `"${l.product.title}" is out of stock`, code: 'OUT_OF_STOCK' });
      if (it.quantity < l.minOrderQty || it.quantity > l.maxOrderQty) throw new BadRequestException(`Invalid quantity for "${l.product.title}"`);
      lines.push({
        listingVariantId: lv.id,
        listingId: l.id,
        title: l.product.title,
        variantName: lv.productVariant.name,
        unitPriceMinor: lv.priceMinor,
        quantity: it.quantity,
        stockMode: l.stockMode,
        leadTimeDays: l.leadTimeDays,
      });
    }

    // Fulfilment validation and fee.
    const opt = merchant.fulfilmentOpts.find(
      (o) => o.method === input.fulfilmentMethod && (input.fulfilmentMethod !== FulfilmentMethod.COLLECTION_POINT || o.collectionPointId === input.collectionPointId),
    );
    if (!opt) throw new BadRequestException('This seller does not offer the selected delivery or collection option');
    let deliveryFeeMinor = 0;
    let fulfilmentSummary: Record<string, unknown> = { method: input.fulfilmentMethod, instructions: opt.instructions };
    switch (input.fulfilmentMethod) {
      case FulfilmentMethod.IN_STORE_COLLECTION: {
        const loc = merchant.locations[0];
        if (!loc) throw new BadRequestException('Seller has no collection location');
        fulfilmentSummary = { ...fulfilmentSummary, location: { label: loc.label, address: loc.publicAddress, unit: loc.unitLabel, area: loc.area.name } };
        break;
      }
      case FulfilmentMethod.COLLECTION_POINT: {
        if (!opt.collectionPoint?.active) throw new BadRequestException('Collection point unavailable');
        deliveryFeeMinor = opt.feeMinor;
        fulfilmentSummary = { ...fulfilmentSummary, collectionPoint: { id: opt.collectionPoint.id, name: opt.collectionPoint.name, address: opt.collectionPoint.publicAddress, openingHours: opt.collectionPoint.openingHours } };
        break;
      }
      case FulfilmentMethod.MERCHANT_DELIVERY:
      case FulfilmentMethod.THIRD_PARTY_DELIVERY: {
        if (!input.deliveryAreaId) throw new BadRequestException('Choose a delivery area');
        const sa = merchant.serviceAreas.find((s) => s.areaId === input.deliveryAreaId);
        if (input.fulfilmentMethod === FulfilmentMethod.MERCHANT_DELIVERY) {
          if (!sa) throw new BadRequestException('This seller does not deliver to the selected area');
          deliveryFeeMinor = sa.deliveryFeeMinor;
          fulfilmentSummary = { ...fulfilmentSummary, area: sa.area.name, etaDays: sa.etaDays };
        } else {
          const area = await this.prisma.area.findUnique({ where: { id: input.deliveryAreaId } });
          if (!area) throw new BadRequestException('Unknown delivery area');
          // Third-party delivery: area fee when the merchant configured one, else the flat option fee.
          deliveryFeeMinor = sa?.deliveryFeeMinor ?? opt.feeMinor;
          fulfilmentSummary = { ...fulfilmentSummary, area: area.name, pickupFromMerchant: opt.pickupFromMerchant };
        }
        break;
      }
    }

    const terms = await this.commission.termsFor(merchant.id, merchant.type, merchant.affiliations.map((a) => a.marketId));
    const subtotalMinor = lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0);
    const serviceFeeMinor = terms.serviceFeeMinor;
    const totalMinor = subtotalMinor + deliveryFeeMinor + serviceFeeMinor;
    if (totalMinor > MAX_AMOUNT_MINOR) throw new BadRequestException('Order total exceeds the maximum for online checkout');
    const requiresConfirmation = lines.some((l) => l.stockMode !== StockMode.TRACKED);
    const maxLead = Math.max(0, ...lines.map((l) => l.leadTimeDays));

    return {
      merchant,
      lines,
      quote: {
        merchant: { id: merchant.id, slug: merchant.slug, displayName: merchant.displayName, type: merchant.type },
        lines: lines.map((l) => ({ ...l, lineTotalMinor: l.unitPriceMinor * l.quantity })),
        subtotalMinor,
        deliveryFeeMinor,
        serviceFeeMinor,
        totalMinor,
        currency: 'NGN',
        requiresConfirmation,
        maxLeadTimeDays: maxLead,
        fulfilment: fulfilmentSummary,
        terms: {
          cancellationPolicy: merchant.cancellationPolicy,
          returnPolicy: merchant.returnPolicy,
          platform:
            'You can cancel free of charge before you pay. After payment you may cancel until the seller accepts the order for a full refund. ' +
            'After that, raise a dispute and KDCN will review it. Refunds go back to your original payment method.',
        },
      },
      commission: terms,
    };
  }

  async place(cartId: string | undefined, input: CheckoutInput, idempotencyKey: string, userId: string | undefined, ip?: string) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey)) throw new BadRequestException('A valid Idempotency-Key header is required');
    if (!userId && (!input.guestEmail || !input.guestPhone)) throw new BadRequestException('Email and phone number are required for guest checkout');
    if (input.acceptTerms !== true) throw new BadRequestException('You must accept the refund and cancellation terms');
    const delivery = input.fulfilmentMethod === FulfilmentMethod.MERCHANT_DELIVERY || input.fulfilmentMethod === FulfilmentMethod.THIRD_PARTY_DELIVERY;
    if (delivery && (!input.deliveryAddress || input.deliveryAddress.length < 5)) throw new BadRequestException('Enter a delivery address');
    const recipientPhone = input.recipientPhone ?? input.guestPhone ?? (userId ? (await this.prisma.user.findUnique({ where: { id: userId } }))?.phone : undefined);
    if (!recipientPhone) throw new BadRequestException('A contact phone number is required');

    const requestHash = sha256(JSON.stringify({ ...input, userId: userId ?? null }));
    const prior = await this.prisma.checkoutSession.findUnique({ where: { idempotencyKey } });
    if (prior) {
      if (prior.requestHash !== requestHash || prior.userId !== (userId ?? null)) throw new ConflictException('Idempotency-Key reused with a different request');
      if (prior.orderId) return { orderId: prior.orderId, replayed: true as const };
      throw new ConflictException('This checkout is still being processed');
    }

    const { merchant, lines, quote, commission } = await this.quote(cartId, input);
    const segment = segmentFor(merchant.type, merchant.affiliations.map((a) => a.market.slug));
    const initialStatus = quote.requiresConfirmation ? OrderStatus.PENDING_MERCHANT_CONFIRMATION : OrderStatus.AWAITING_PAYMENT;
    const now = Date.now();
    const guestToken = userId ? null : randomToken(24);

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        await tx.checkoutSession.create({ data: { idempotencyKey, userId: userId ?? null, merchantId: merchant.id, requestHash } });
        const o = await tx.order.create({
          data: {
            number: orderNumber(),
            customerId: userId ?? null,
            guestEmail: userId ? null : input.guestEmail,
            guestPhone: userId ? null : input.guestPhone,
            guestAccessHash: guestToken ? sha256(guestToken) : null,
            merchantId: merchant.id,
            status: OrderStatus.DRAFT,
            segment,
            subtotalMinor: quote.subtotalMinor,
            deliveryFeeMinor: quote.deliveryFeeMinor,
            serviceFeeMinor: quote.serviceFeeMinor,
            totalMinor: quote.totalMinor,
            commissionBps: commission.rateBps,
            commissionMinor: applyBps(quote.subtotalMinor, commission.rateBps),
            merchantSnapshot: { id: merchant.id, slug: merchant.slug, displayName: merchant.displayName, type: merchant.type, publicAreaLabel: merchant.publicAreaLabel, contactPhone: merchant.contactPhone, markets: merchant.affiliations.map((a) => a.market.name) },
            termsSnapshot: { ...quote.terms, commissionRuleId: commission.ruleId, commissionScope: commission.scope, fulfilment: quote.fulfilment, guestName: input.guestName ?? null } as Prisma.InputJsonValue,
            fulfilmentMethod: input.fulfilmentMethod,
            customerNote: input.customerNote,
            confirmationDeadline: quote.requiresConfirmation ? new Date(now + env().CONFIRMATION_WINDOW_MINUTES * 60_000) : null,
            paymentDeadline: quote.requiresConfirmation ? null : new Date(now + env().PAYMENT_WINDOW_MINUTES * 60_000),
            items: {
              create: lines.map((l) => ({
                listingVariantId: l.listingVariantId,
                listingId: l.listingId,
                productTitle: l.title,
                variantName: l.variantName,
                unitPriceMinor: l.unitPriceMinor,
                quantity: l.quantity,
                lineTotalMinor: l.unitPriceMinor * l.quantity,
                stockMode: l.stockMode,
                leadTimeDays: l.leadTimeDays,
              })),
            },
            fulfilment: {
              create: {
                method: input.fulfilmentMethod,
                collectionPointId: input.fulfilmentMethod === FulfilmentMethod.COLLECTION_POINT ? input.collectionPointId : null,
                deliveryAreaId: delivery ? input.deliveryAreaId : null,
                deliveryAddressEnc: delivery && input.deliveryAddress ? encryptField(input.deliveryAddress) : null,
                recipientPhone,
                chargeMinor: quote.deliveryFeeMinor,
                pickupFromMerchant: (quote.fulfilment as { pickupFromMerchant?: boolean }).pickupFromMerchant ?? false,
              },
            },
          },
        });
        await tx.orderEvent.create({ data: { orderId: o.id, fromStatus: null, toStatus: OrderStatus.DRAFT, actorUserId: userId ?? null, actorType: 'customer', note: 'Order placed' } });
        const reserved = await this.inventory.reserve(tx, lines.map((l) => ({ ...l })));
        await this.orderState.transition(tx, o, initialStatus, { type: 'system' }, quote.requiresConfirmation ? 'Awaiting seller confirmation' : 'All items in stock — ready for payment', { stockReserved: reserved });
        await tx.checkoutSession.update({ where: { idempotencyKey }, data: { orderId: o.id } });
        await tx.cartItem.deleteMany({ where: { cartId: cartId!, listingVariantId: { in: lines.map((l) => l.listingVariantId) } } });
        await this.audit.record({ actor: null, action: 'order.placed', entityType: 'order', entityId: o.id, merchantId: merchant.id, metadata: { totalMinor: o.totalMinor, status: initialStatus, guest: !userId }, ip }, tx);

        const members = await tx.merchantMember.findMany({ where: { merchantId: merchant.id }, include: { user: true } });
        for (const m of members) {
          await this.notifications.enqueue(
            {
              userId: m.userId,
              email: m.user.email,
              phone: merchant.contactPhone,
              channels: ['EMAIL', 'SMS'],
              template: quote.requiresConfirmation ? 'merchant.confirm_order' : 'merchant.new_order',
              subject: quote.requiresConfirmation ? `New order ${o.number}: please confirm availability` : `New order ${o.number}`,
              body: quote.requiresConfirmation
                ? `A customer ordered ${lines.length} item(s). Confirm availability within ${Math.round(env().CONFIRMATION_WINDOW_MINUTES / 60)} hours so they can pay.`
                : `A customer is paying for ${lines.length} in-stock item(s).`,
              data: { orderId: o.id, merchantId: merchant.id },
            },
            tx,
          );
        }
        return o;
      });
      return { orderId: order.id, guestAccessToken: guestToken, replayed: false as const };
    } catch (e) {
      // A concurrent request with the same key won the race.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('idempotencyKey')) {
        const winner = await this.prisma.checkoutSession.findUnique({ where: { idempotencyKey } });
        if (winner?.orderId) return { orderId: winner.orderId, replayed: true as const };
        throw new ConflictException('This checkout is still being processed');
      }
      throw e;
    }
  }

  /** Resolve the order for a guest using the access token. */
  async findForGuest(orderId: string, token: string) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!o || !o.guestAccessHash || o.guestAccessHash !== sha256(token)) throw new NotFoundException('Order not found');
    return o;
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function orderNumber(): string {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  let suffix = '';
  const bytes = randomToken(8);
  for (let i = 0; i < 6; i++) suffix += ALPHABET[bytes.charCodeAt(i) % ALPHABET.length];
  return `KD${ymd}-${suffix}`;
}
