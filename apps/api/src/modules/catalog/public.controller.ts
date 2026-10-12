import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ListingStatus, MarketKind, MerchantType, ReportTarget, ReviewStatus } from '@prisma/client';
import { z } from 'zod';
import { Auth, Public } from '../../common/auth/decorators';
import { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { parse, zId, zText } from '../../common/validation';
import { mediaUrl, PUBLIC_MERCHANT_SELECT, serializePublicMerchant, VISIBLE_MERCHANT_WHERE } from '../merchants/merchant-public';
import { searchSchema, SearchService } from '../search/search.service';
import { availabilityFor } from './availability';
import { ListingCardService, VISIBLE_LISTING_WHERE } from './listing-card.service';

@Controller()
export class PublicCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchService: SearchService,
    private readonly cards: ListingCardService,
  ) {}

  @Public()
  @Get('geo/cities')
  async cities() {
    return this.prisma.city.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, state: true, areas: { orderBy: { name: 'asc' }, select: { id: true, slug: true, name: true } } },
    });
  }

  @Public()
  @Get('categories')
  async categories() {
    const all = await this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return all
      .filter((c) => !c.parentId)
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        homeVendorPolicy: c.homeVendorPolicy,
        children: all.filter((x) => x.parentId === c.id).map((x) => ({ id: x.id, slug: x.slug, name: x.name, homeVendorPolicy: x.homeVendorPolicy })),
      }));
  }

  @Public()
  @Get('search')
  async search(@Query() query: unknown) {
    return this.searchService.search(parse(searchSchema, query));
  }

  @Public()
  @Get('home')
  async home() {
    const [markets, featuredMerchants, recent, homeVendorItems, independentItems, collections] = await Promise.all([
      this.prisma.market.findMany({
        where: { active: true },
        orderBy: [{ branded: 'desc' }, { name: 'asc' }],
        select: { id: true, slug: true, name: true, kind: true, tagline: true, coverKey: true, branded: true, area: { select: { name: true } }, _count: { select: { affiliations: { where: { status: 'APPROVED' } } } } },
      }),
      this.prisma.merchant.findMany({
        where: { ...VISIBLE_MERCHANT_WHERE, verifications: { some: { status: 'APPROVED' } }, listings: { some: { status: ListingStatus.ACTIVE } } },
        orderBy: { approvedAt: 'desc' },
        take: 8,
        select: PUBLIC_MERCHANT_SELECT,
      }),
      this.cards.find({}, 12),
      this.cards.find({ merchant: { type: MerchantType.HOME_VENDOR } }, 8),
      this.cards.find({ merchant: { type: MerchantType.INDEPENDENT_SHOP } }, 8),
      this.prisma.productCollection.findMany({ where: { featured: true }, take: 4, select: { slug: true, title: true, description: true, items: { take: 8, orderBy: { sortOrder: 'asc' }, select: { listingId: true } } } }),
    ]);
    return {
      markets: markets.map((m) => ({ ...m, coverUrl: mediaUrl(m.coverKey), merchantCount: m._count.affiliations, coverKey: undefined, _count: undefined })),
      featuredMerchants: featuredMerchants.map(serializePublicMerchant),
      recentListings: recent,
      homeVendorListings: homeVendorItems,
      independentListings: independentItems,
      collections: await Promise.all(
        collections.map(async (c) => ({ slug: c.slug, title: c.title, description: c.description, items: await this.cards.byIds(c.items.map((i) => i.listingId)) })),
      ),
      sponsored: [], // Sponsored placements are not enabled in Release 1. When enabled they must be labelled.
    };
  }

  @Public()
  @Get('listings/:slug')
  async listing(@Param('slug') slug: string) {
    const l = await this.prisma.listing.findFirst({
      where: { slug, ...VISIBLE_LISTING_WHERE },
      include: {
        product: { include: { category: { include: { parent: true } }, images: { orderBy: { sortOrder: 'asc' } } } },
        variants: { where: { active: true }, include: { inventory: true, productVariant: true } },
        merchant: {
          select: {
            ...PUBLIC_MERCHANT_SELECT,
            fulfilmentOpts: { where: { enabled: true }, include: { collectionPoint: { select: { id: true, name: true, publicAddress: true, openingHours: true } } } },
            serviceAreas: { include: { area: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!l) throw new NotFoundException('Product not found');
    const rating = await this.prisma.review.aggregate({
      where: { merchantId: l.merchantId, status: { not: ReviewStatus.HIDDEN } },
      _avg: { rating: true },
      _count: true,
    });
    const { fulfilmentOpts, serviceAreas, ...merchantPublic } = l.merchant;
    return {
      id: l.id,
      slug: l.slug,
      title: l.product.title,
      description: l.product.description,
      brand: l.product.brand,
      attributes: l.product.attributes,
      category: { slug: l.product.category.slug, name: l.product.category.name, parent: l.product.category.parent ? { slug: l.product.category.parent.slug, name: l.product.category.parent.name } : null },
      images: l.product.images.map((i) => ({ url: mediaUrl(i.storageKey), alt: i.alt || l.product.title })),
      stockMode: l.stockMode,
      leadTimeDays: l.leadTimeDays,
      minOrderQty: l.minOrderQty,
      maxOrderQty: l.maxOrderQty,
      returnPolicy: l.returnPolicy ?? l.merchant.returnPolicy,
      cancellationPolicy: l.merchant.cancellationPolicy,
      requiresConfirmation: l.stockMode !== 'TRACKED',
      variants: l.variants.map((v) => ({
        id: v.id,
        name: v.productVariant.name,
        options: v.productVariant.options,
        priceMinor: v.priceMinor,
        compareAtMinor: v.compareAtMinor,
        availability: availabilityFor(l.stockMode, l.leadTimeDays, v.inventory),
      })),
      merchant: { ...serializePublicMerchant(merchantPublic), rating: { average: rating._avg.rating, count: rating._count } },
      fulfilment: {
        options: fulfilmentOpts.map((o) => ({
          method: o.method,
          feeMinor: o.feeMinor,
          instructions: o.instructions,
          collectionPoint: o.collectionPoint,
        })),
        deliveryAreas: serviceAreas.map((s) => ({ areaId: s.area.id, name: s.area.name, feeMinor: s.deliveryFeeMinor, etaDays: s.etaDays })),
      },
    };
  }

  @Public()
  @Get('storefronts/:slug')
  async storefront(@Param('slug') slug: string, @Query() query: unknown) {
    const q = parse(z.object({ page: z.coerce.number().int().min(1).max(100).default(1), category: z.string().max(60).optional() }), query);
    const m = await this.prisma.merchant.findFirst({
      where: { slug, ...VISIBLE_MERCHANT_WHERE },
      select: {
        ...PUBLIC_MERCHANT_SELECT,
        fulfilmentOpts: { where: { enabled: true }, include: { collectionPoint: { select: { name: true, publicAddress: true } } } },
        serviceAreas: { include: { area: { select: { name: true } } } },
      },
    });
    if (!m) throw new NotFoundException('Store not found');
    const pageSize = 24;
    const where = { merchantId: m.id, ...(q.category ? { product: { category: { slug: q.category } } } : {}) };
    const [listings, total, rating, reviews] = await Promise.all([
      this.prisma.listing.findMany({ where: { ...where, ...VISIBLE_LISTING_WHERE }, select: { id: true }, orderBy: { publishedAt: 'desc' }, skip: (q.page - 1) * pageSize, take: pageSize }),
      this.prisma.listing.count({ where: { ...where, ...VISIBLE_LISTING_WHERE } }),
      this.prisma.review.aggregate({ where: { merchantId: m.id, status: { not: ReviewStatus.HIDDEN } }, _avg: { rating: true }, _count: true }),
      this.prisma.review.findMany({
        where: { merchantId: m.id, status: { not: ReviewStatus.HIDDEN } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, rating: true, body: true, merchantResponse: true, createdAt: true, customer: { select: { name: true } } },
      }),
    ]);
    const { fulfilmentOpts, serviceAreas, ...pub } = m;
    return {
      merchant: serializePublicMerchant(pub),
      fulfilment: {
        methods: [...new Set(fulfilmentOpts.map((o) => o.method))],
        collectionPoints: fulfilmentOpts.filter((o) => o.collectionPoint).map((o) => o.collectionPoint),
        deliveryAreas: serviceAreas.map((s) => s.area.name),
      },
      rating: { average: rating._avg.rating, count: rating._count },
      // Reviewer names are reduced to a first name + initial.
      reviews: reviews.map((r) => ({ ...r, customer: { name: shortName(r.customer.name) } })),
      listings: { items: await this.cards.byIds(listings.map((l) => l.id)), total, page: q.page, pageSize },
    };
  }

  @Public()
  @Get('markets')
  async markets(@Query() query: unknown) {
    const q = parse(z.object({ kind: z.nativeEnum(MarketKind).optional() }), query);
    const rows = await this.prisma.market.findMany({
      where: { active: true, kind: q.kind },
      orderBy: [{ branded: 'desc' }, { name: 'asc' }],
      include: { city: true, area: true, _count: { select: { affiliations: { where: { status: 'APPROVED' } } } } },
    });
    return rows.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      kind: m.kind,
      tagline: m.tagline,
      city: m.city.name,
      area: m.area?.name ?? null,
      coverUrl: mediaUrl(m.coverKey),
      branded: m.branded,
      merchantCount: m._count.affiliations,
    }));
  }

  @Public()
  @Get('markets/:slug')
  async market(@Param('slug') slug: string) {
    const m = await this.prisma.market.findFirst({
      where: { slug, active: true },
      include: {
        city: true,
        area: true,
        collectionPoints: { where: { active: true }, select: { id: true, name: true, publicAddress: true, openingHours: true, instructions: true } },
        announcements: {
          where: { published: true, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
          orderBy: { startsAt: 'desc' },
          take: 5,
          select: { id: true, title: true, body: true, startsAt: true },
        },
        collections: { select: { slug: true, title: true, description: true, items: { take: 12, orderBy: { sortOrder: 'asc' }, select: { listingId: true } } } },
      },
    });
    if (!m) throw new NotFoundException('Market not found');
    const merchants = await this.prisma.merchant.findMany({
      where: { ...VISIBLE_MERCHANT_WHERE, affiliations: { some: { marketId: m.id, status: 'APPROVED' } } },
      orderBy: { displayName: 'asc' },
      select: PUBLIC_MERCHANT_SELECT,
    });
    const categories = await this.prisma.category.findMany({
      where: { products: { some: { listings: { some: { ...VISIBLE_LISTING_WHERE, merchant: { affiliations: { some: { marketId: m.id, status: 'APPROVED' } } } } } } } },
      select: { slug: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      id: m.id,
      slug: m.slug,
      name: m.name,
      kind: m.kind,
      tagline: m.tagline,
      description: m.description,
      publicAddress: m.publicAddress,
      openingHours: m.openingHours,
      city: m.city.name,
      area: m.area?.name ?? null,
      coverUrl: mediaUrl(m.coverKey),
      logoUrl: mediaUrl(m.logoKey),
      branded: m.branded,
      announcements: m.announcements,
      collectionPoints: m.collectionPoints,
      categories,
      merchants: merchants.map(serializePublicMerchant),
      collections: await Promise.all(m.collections.map(async (c) => ({ slug: c.slug, title: c.title, description: c.description, items: await this.cards.byIds(c.items.map((i) => i.listingId)) }))),
      newArrivals: await this.cards.find({ merchant: { affiliations: { some: { marketId: m.id, status: 'APPROVED' } } } }, 12),
    };
  }

  @Public()
  @Get('collections/:slug')
  async collection(@Param('slug') slug: string) {
    const c = await this.prisma.productCollection.findUnique({ where: { slug }, include: { items: { orderBy: { sortOrder: 'asc' } }, market: { select: { slug: true, name: true } } } });
    if (!c) throw new NotFoundException('Collection not found');
    return { slug: c.slug, title: c.title, description: c.description, market: c.market, items: await this.cards.byIds(c.items.map((i) => i.listingId)) };
  }

  @Post('enquiries')
  async enquire(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(z.object({ merchantSlug: z.string().max(60), listingId: zId.optional(), message: zText(2000).min(5) }), body);
    const m = await this.prisma.merchant.findFirst({ where: { slug: input.merchantSlug, ...VISIBLE_MERCHANT_WHERE } });
    if (!m) throw new NotFoundException('Store not found');
    const e = await this.prisma.enquiry.create({ data: { merchantId: m.id, listingId: input.listingId, customerId: auth.user.id, message: input.message } });
    return { id: e.id, createdAt: e.createdAt };
  }

  @Get('enquiries')
  async myEnquiries(@Auth() auth: AuthContext) {
    return this.prisma.enquiry.findMany({
      where: { customerId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, message: true, reply: true, repliedAt: true, createdAt: true, merchant: { select: { slug: true, displayName: true } } },
    });
  }

  /** Report a suspicious listing, merchant or review. */
  @Post('reports')
  @HttpCode(201)
  async report(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(
      z.object({ targetType: z.nativeEnum(ReportTarget), targetId: zId, reason: z.enum(['counterfeit', 'prohibited_item', 'fraud', 'misleading', 'offensive', 'other']), details: zText(2000).default('') }),
      body,
    );
    const exists =
      input.targetType === 'LISTING'
        ? await this.prisma.listing.count({ where: { id: input.targetId } })
        : input.targetType === 'MERCHANT'
          ? await this.prisma.merchant.count({ where: { id: input.targetId } })
          : await this.prisma.review.count({ where: { id: input.targetId } });
    if (!exists) throw new NotFoundException();
    const r = await this.prisma.abuseReport.create({ data: { ...input, reporterId: auth.user.id } });
    if (input.targetType === 'REVIEW') {
      await this.prisma.review.updateMany({ where: { id: input.targetId, status: ReviewStatus.PUBLISHED }, data: { status: ReviewStatus.FLAGGED } });
    }
    return { id: r.id };
  }
}

function shortName(name: string): string {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}
