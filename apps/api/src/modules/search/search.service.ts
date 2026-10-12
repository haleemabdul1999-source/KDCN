import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { ListingCardService } from '../catalog/listing-card.service';

export const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(60).optional(),
  merchant: z.string().max(60).optional(),
  market: z.string().max(60).optional(),
  city: z.string().max(60).optional(),
  area: z.string().uuid().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  availability: z.enum(['any', 'in_stock', 'made_to_order', 'confirm_on_order']).default('any'),
  fulfilment: z.enum(['any', 'delivery', 'collection']).default('any'),
  verified: z.enum(['true', 'false']).optional(),
  merchantType: z
    .enum(['HOME_VENDOR', 'MALL_RETAILER', 'MARKET_TRADER', 'INDEPENDENT_SHOP'])
    .optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).default('relevance'),
  page: z.coerce.number().int().min(1).max(100).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});
export type SearchInput = z.infer<typeof searchSchema>;

/** Turn free text into a safe prefix tsquery string: "red ankara" → "red:* & ankara:*". */
export function toPrefixQuery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

/**
 * Listing search on PostgreSQL full-text search with trigram fallback for typos.
 *
 * Ranking (relevance sort): text relevance, then purchasability (out-of-stock items sink),
 * then a small buyer-experience signal (merchant rating). There is no paid placement in
 * organic ranking; if sponsored placements are introduced they must be shown separately
 * and labelled.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: ListingCardService,
  ) {}

  async search(input: SearchInput) {
    const conds: Prisma.Sql[] = [
      Prisma.sql`l.status = 'ACTIVE'`,
      Prisma.sql`m.status = 'APPROVED'`,
      Prisma.sql`p."moderationStatus" = 'APPROVED'`,
      Prisma.sql`price.min_price IS NOT NULL`,
    ];
    const prefix = input.q ? toPrefixQuery(input.q) : null;
    let rel: Prisma.Sql = Prisma.sql`0`;
    if (input.q && prefix) {
      conds.push(Prisma.sql`(l."searchVector" @@ to_tsquery('simple', ${prefix})
        OR word_similarity(${input.q}, p.title) >= 0.45 OR m."displayName" ILIKE ${'%' + input.q.replace(/[%_\\]/g, '') + '%'})`);
      rel = Prisma.sql`(ts_rank_cd(l."searchVector", to_tsquery('simple', ${prefix})) + word_similarity(${input.q}, p.title))`;
    }
    if (input.category) {
      conds.push(Prisma.sql`p."categoryId" IN (
        SELECT c.id FROM categories c WHERE c.slug = ${input.category}
        UNION SELECT c2.id FROM categories c2 JOIN categories pc ON pc.id = c2."parentId" WHERE pc.slug = ${input.category})`);
    }
    if (input.merchant) conds.push(Prisma.sql`m.slug = ${input.merchant}`);
    if (input.market) {
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM market_affiliations a JOIN markets mk ON mk.id = a."marketId"
        WHERE a."merchantId" = m.id AND a.status = 'APPROVED' AND mk.slug = ${input.market})`);
    }
    if (input.area) {
      // Located in the area, or delivers to it.
      conds.push(Prisma.sql`(m."publicAreaId" = ${input.area} OR EXISTS (
        SELECT 1 FROM merchant_service_areas sa WHERE sa."merchantId" = m.id AND sa."areaId" = ${input.area}))`);
    }
    if (input.city) {
      conds.push(
        Prisma.sql`m."publicAreaId" IN (SELECT ar.id FROM areas ar JOIN cities ci ON ci.id = ar."cityId" WHERE ci.slug = ${input.city})`,
      );
    }
    if (input.minPrice !== undefined) conds.push(Prisma.sql`price.min_price >= ${input.minPrice}`);
    if (input.maxPrice !== undefined) conds.push(Prisma.sql`price.min_price <= ${input.maxPrice}`);
    if (input.availability === 'in_stock')
      conds.push(Prisma.sql`l."stockMode" = 'TRACKED' AND av.in_stock`);
    if (input.availability === 'made_to_order')
      conds.push(Prisma.sql`l."stockMode" = 'MADE_TO_ORDER'`);
    if (input.availability === 'confirm_on_order')
      conds.push(Prisma.sql`l."stockMode" = 'CONFIRM_ON_ORDER'`);
    if (input.fulfilment !== 'any') {
      const methods =
        input.fulfilment === 'delivery'
          ? ['MERCHANT_DELIVERY', 'THIRD_PARTY_DELIVERY']
          : ['IN_STORE_COLLECTION', 'COLLECTION_POINT'];
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM merchant_fulfilment_options fo WHERE fo."merchantId" = m.id AND fo.enabled
        AND fo.method::text IN (${Prisma.join(methods)}))`);
    }
    if (input.verified === 'true') {
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM merchant_verifications v WHERE v."merchantId" = m.id AND v.status = 'APPROVED'
        AND (v."expiresAt" IS NULL OR v."expiresAt" > now()))`);
    }
    if (input.merchantType) conds.push(Prisma.sql`m.type::text = ${input.merchantType}`);

    const purchasable = Prisma.sql`(l."stockMode" <> 'TRACKED' OR av.in_stock)`;
    const score = Prisma.sql`(${rel} + CASE WHEN ${purchasable} THEN 0.2 ELSE -1 END + COALESCE(rt.avg_rating - 3, 0) * 0.02)`;
    const order =
      input.sort === 'price_asc'
        ? Prisma.sql`price.min_price ASC, l.id`
        : input.sort === 'price_desc'
          ? Prisma.sql`price.min_price DESC, l.id`
          : input.sort === 'newest'
            ? Prisma.sql`l."publishedAt" DESC NULLS LAST, l.id`
            : Prisma.sql`${score} DESC, l."publishedAt" DESC NULLS LAST, l.id`;

    const from = Prisma.sql`
      FROM listings l
      JOIN products p ON p.id = l."productId"
      JOIN merchants m ON m.id = l."merchantId"
      LEFT JOIN LATERAL (SELECT min(lv."priceMinor") AS min_price FROM listing_variants lv
        WHERE lv."listingId" = l.id AND lv.active) price ON true
      LEFT JOIN LATERAL (SELECT COALESCE(bool_or(i.quantity - i.reserved > 0), false) AS in_stock
        FROM listing_variants lv LEFT JOIN inventory i ON i."listingVariantId" = lv.id
        WHERE lv."listingId" = l.id AND lv.active) av ON true
      LEFT JOIN LATERAL (SELECT avg(r.rating)::float AS avg_rating FROM reviews r
        WHERE r."merchantId" = m.id AND r.status <> 'HIDDEN') rt ON true
      WHERE ${Prisma.join(conds, ' AND ')}`;

    const offset = (input.page - 1) * input.pageSize;
    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string }[]
      >`SELECT l.id ${from} ORDER BY ${order} LIMIT ${input.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
    ]);
    const items = await this.cards.byIds(rows.map((r) => r.id));
    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
      page: input.page,
      pageSize: input.pageSize,
    };
  }
}
