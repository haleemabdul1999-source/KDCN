import { Injectable } from '@nestjs/common';
import { ListingStatus, MerchantStatus, ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { mediaUrl } from '../merchants/merchant-public';
import { availabilityFor } from './availability';

export const VISIBLE_LISTING_WHERE = {
  status: ListingStatus.ACTIVE,
  merchant: { status: MerchantStatus.APPROVED },
  product: { moderationStatus: ModerationStatus.APPROVED },
} satisfies Prisma.ListingWhereInput;

const CARD_INCLUDE = {
  product: {
    select: {
      title: true,
      category: { select: { slug: true, name: true } },
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
    },
  },
  variants: { where: { active: true }, include: { inventory: true } },
  merchant: {
    select: {
      slug: true,
      displayName: true,
      type: true,
      publicAreaLabel: true,
      verifications: { where: { status: 'APPROVED' }, take: 1, select: { expiresAt: true } },
      affiliations: {
        where: { status: 'APPROVED' },
        select: { market: { select: { slug: true, name: true } } },
      },
      fulfilmentOpts: { where: { enabled: true }, select: { method: true } },
    },
  },
} satisfies Prisma.ListingInclude;

type CardRow = Prisma.ListingGetPayload<{ include: typeof CARD_INCLUDE }>;

/** Compact, public-safe listing representation used in search results and collections. */
@Injectable()
export class ListingCardService {
  constructor(private readonly prisma: PrismaService) {}

  async byIds(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.listing.findMany({
      where: { id: { in: ids }, ...VISIBLE_LISTING_WHERE },
      include: CARD_INCLUDE,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is CardRow => !!r)
      .map((r) => this.serialize(r));
  }

  async find(
    where: Prisma.ListingWhereInput,
    take: number,
    orderBy: Prisma.ListingOrderByWithRelationInput = { publishedAt: 'desc' },
  ) {
    const rows = await this.prisma.listing.findMany({
      where: { AND: [where, VISIBLE_LISTING_WHERE] },
      include: CARD_INCLUDE,
      take,
      orderBy,
    });
    return rows.filter((r) => r.variants.length > 0).map((r) => this.serialize(r));
  }

  serialize(l: CardRow) {
    const prices = l.variants.map((v) => v.priceMinor);
    const cheapest = l.variants.reduce(
      (a, b) => (b.priceMinor < a.priceMinor ? b : a),
      l.variants[0],
    );
    const anyAvailable = l.variants
      .map((v) => availabilityFor(l.stockMode, l.leadTimeDays, v.inventory))
      .sort((a, b) => Number(b.purchasable) - Number(a.purchasable))[0];
    const methods = new Set(l.merchant.fulfilmentOpts.map((o) => o.method));
    const v = l.merchant.verifications[0];
    return {
      id: l.id,
      slug: l.slug,
      title: l.product.title,
      category: l.product.category,
      imageUrl: mediaUrl(l.product.images[0]?.storageKey),
      imageAlt: l.product.images[0]?.alt || l.product.title,
      priceFromMinor: prices.length ? Math.min(...prices) : null,
      hasMultiplePrices: new Set(prices).size > 1,
      compareAtMinor: cheapest?.compareAtMinor ?? null,
      stockMode: l.stockMode,
      availability: anyAvailable ?? availabilityFor(l.stockMode, l.leadTimeDays, null),
      merchant: {
        slug: l.merchant.slug,
        displayName: l.merchant.displayName,
        type: l.merchant.type,
        areaLabel: l.merchant.publicAreaLabel,
        identityVerified: !!v && (!v.expiresAt || v.expiresAt > new Date()),
        markets: l.merchant.affiliations.map((a) => a.market),
      },
      fulfilment: {
        delivery: methods.has('MERCHANT_DELIVERY') || methods.has('THIRD_PARTY_DELIVERY'),
        collection: methods.has('IN_STORE_COLLECTION') || methods.has('COLLECTION_POINT'),
      },
    };
  }
}
