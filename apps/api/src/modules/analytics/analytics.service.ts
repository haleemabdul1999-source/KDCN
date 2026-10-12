import { Injectable } from '@nestjs/common';
import { AnalyticsEventType, MerchantSegment, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { hmacSha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';

export const SEGMENTS: MerchantSegment[] = [MerchantSegment.GALAXY_MALL, MerchantSegment.OTHER_MARKET, MerchantSegment.HOME_VENDOR, MerchantSegment.INDEPENDENT];

/**
 * Metric definitions (also in docs/ANALYTICS.md). All money in kobo. "Period" = [from, to).
 *
 *  ordersInitiated      orders placed in period (any status except DRAFT)
 *  paidOrders           orders whose verified payment landed in period (paidAt ∈ period)
 *  ordersCompleted      orders reaching COMPLETED in period
 *  ordersCancelled      orders cancelled in period
 *  failedPayments       payment attempts verified FAILED in period
 *  gmvMinor             Σ subtotal (goods only, excl. delivery and service fees) of paid orders; before refunds
 *  platformRevenueMinor Σ (commission + customer service fee) of paid orders, excluding orders fully refunded
 *  deliveryFeesRetainedMinor Σ delivery fees on paid orders not delivered by the merchant (pass-through to logistics)
 *  refundsMinor         Σ successful refunds completed in period (excluding refunds of duplicate payments)
 *  providerFeesMinor    Σ provider fees on payments succeeding in period
 *  logisticsCostsMinor  Σ recorded logistics costs for platform-coordinated deliveries paid in period
 *  contributionMarginMinor = platformRevenue + deliveryFeesRetained − providerFees − logisticsCosts
 *      marked incomplete when any provider fee or platform-coordinated logistics cost is unknown.
 *  checkoutConversion   paidOrders / ordersInitiated (same period)
 *  searchToProductRate  search-result clicks / searches
 *  repeatPurchaseRate   customers with ≥2 lifetime paid orders ÷ customers with ≥1 paid order in period
 *  activeMerchants      distinct merchants with ≥1 paid order in period
 *  merchantRetention    merchants active in both the previous equal-length period and this one ÷ merchants active in the previous period
 *  avgHoursPaidToDelivered  mean hours from payment to delivery/collection for orders delivered in period
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  visitorHash(ip: string | undefined, ua: string | undefined): string {
    const day = new Date().toISOString().slice(0, 10);
    return hmacSha256(`${env().APP_SECRET}:${day}`, `${ip ?? ''}|${ua ?? ''}`).slice(0, 32);
  }

  async track(input: { type: AnalyticsEventType; visitorHash: string; userId?: string; merchantId?: string; listingId?: string; query?: string; resultCount?: number }) {
    await this.prisma.analyticsEvent.create({ data: { ...input, query: input.query?.slice(0, 100) } });
  }

  async platformMetrics(from: Date, to: Date, merchantId?: string) {
    const segments = merchantId ? (['ALL'] as const) : (['ALL', ...SEGMENTS] as const);
    const result: Record<string, unknown> = {};
    for (const seg of segments) {
      result[seg] = await this.metricsFor(from, to, seg === 'ALL' ? undefined : (seg as MerchantSegment), merchantId);
    }
    const merchants = await this.merchantCounts();
    return { period: { from, to }, segments: result, merchants, definitionsDoc: 'docs/ANALYTICS.md' };
  }

  private async metricsFor(from: Date, to: Date, segment?: MerchantSegment, merchantId?: string) {
    const segSql = segment ? Prisma.sql`AND o.segment::text = ${segment}` : Prisma.empty;
    const mSql = merchantId ? Prisma.sql`AND o."merchantId" = ${merchantId}` : Prisma.empty;
    const f = Prisma.sql`${segSql} ${mSql}`;

    const [orders] = await this.prisma.$queryRaw<
      {
        initiated: bigint; paid: bigint; completed: bigint; cancelled: bigint; gmv: bigint | null; revenue: bigint | null;
        delivery_retained: bigint | null; provider_fees: bigint | null; provider_fee_unknown: bigint; logistics_costs: bigint | null;
        logistics_unknown: bigint; active_merchants: bigint; avg_hours_to_delivery: number | null; delivered: bigint;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM orders o WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to} AND o.status <> 'DRAFT' ${f}) AS initiated,
        (SELECT count(*) FROM orders o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}) AS paid,
        (SELECT count(*) FROM orders o WHERE o."completedAt" >= ${from} AND o."completedAt" < ${to} AND o.status = 'COMPLETED' ${f}) AS completed,
        (SELECT count(*) FROM orders o WHERE o."cancelledAt" >= ${from} AND o."cancelledAt" < ${to} ${f}) AS cancelled,
        (SELECT sum(o."subtotalMinor") FROM orders o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}) AS gmv,
        (SELECT sum(o."commissionMinor" + o."serviceFeeMinor") FROM orders o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o.status <> 'REFUNDED' ${f}) AS revenue,
        (SELECT sum(o."deliveryFeeMinor") FROM orders o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o."fulfilmentMethod" <> 'MERCHANT_DELIVERY' AND o.status <> 'REFUNDED' ${f}) AS delivery_retained,
        (SELECT sum(p."providerFeeMinor") FROM payment_transactions p JOIN orders o ON o.id = p."orderId" WHERE p.status = 'SUCCEEDED' AND p."paidAt" >= ${from} AND p."paidAt" < ${to} ${f}) AS provider_fees,
        (SELECT count(*) FROM payment_transactions p JOIN orders o ON o.id = p."orderId" WHERE p.status = 'SUCCEEDED' AND p."providerFeeMinor" IS NULL AND p."paidAt" >= ${from} AND p."paidAt" < ${to} ${f}) AS provider_fee_unknown,
        (SELECT sum(fu."logisticsCostMinor") FROM fulfilments fu JOIN orders o ON o.id = fu."orderId" WHERE fu.method = 'THIRD_PARTY_DELIVERY' AND o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}) AS logistics_costs,
        (SELECT count(*) FROM fulfilments fu JOIN orders o ON o.id = fu."orderId" WHERE fu.method = 'THIRD_PARTY_DELIVERY' AND fu."logisticsCostMinor" IS NULL AND o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}) AS logistics_unknown,
        (SELECT count(DISTINCT o."merchantId") FROM orders o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}) AS active_merchants,
        (SELECT avg(extract(epoch FROM (fu."completedAt" - o."paidAt")) / 3600)::float FROM fulfilments fu JOIN orders o ON o.id = fu."orderId"
           WHERE fu."completedAt" >= ${from} AND fu."completedAt" < ${to} AND o."paidAt" IS NOT NULL ${f}) AS avg_hours_to_delivery,
        (SELECT count(*) FROM fulfilments fu JOIN orders o ON o.id = fu."orderId" WHERE fu."completedAt" >= ${from} AND fu."completedAt" < ${to} ${f}) AS delivered`;

    const [extra] = await this.prisma.$queryRaw<
      { failed_payments: bigint; refunds: bigint | null; refund_count: bigint; disputes: bigint; failed_attempts: bigint | null; buyers: bigint; repeat_buyers: bigint; prev_active: bigint; retained: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM payment_transactions p JOIN orders o ON o.id = p."orderId" WHERE p.status = 'FAILED' AND p."updatedAt" >= ${from} AND p."updatedAt" < ${to} ${f}) AS failed_payments,
        (SELECT sum(r."amountMinor") FROM refunds r JOIN orders o ON o.id = r."orderId" JOIN payment_transactions p ON p.id = r."paymentTransactionId"
           WHERE r.status = 'SUCCEEDED' AND NOT p."isDuplicate" AND r."completedAt" >= ${from} AND r."completedAt" < ${to} ${f}) AS refunds,
        (SELECT count(*) FROM refunds r JOIN orders o ON o.id = r."orderId" JOIN payment_transactions p ON p.id = r."paymentTransactionId"
           WHERE r.status = 'SUCCEEDED' AND NOT p."isDuplicate" AND r."completedAt" >= ${from} AND r."completedAt" < ${to} ${f}) AS refund_count,
        (SELECT count(*) FROM disputes d JOIN orders o ON o.id = d."orderId" WHERE d."createdAt" >= ${from} AND d."createdAt" < ${to} ${f}) AS disputes,
        (SELECT sum(fu."failedAttempts") FROM fulfilments fu JOIN orders o ON o.id = fu."orderId" WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}) AS failed_attempts,
        (SELECT count(DISTINCT o."customerId") FROM orders o WHERE o."customerId" IS NOT NULL AND o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}) AS buyers,
        (SELECT count(*) FROM (SELECT o."customerId" FROM orders o WHERE o."customerId" IN
            (SELECT o2."customerId" FROM orders o2 WHERE o2."paidAt" >= ${from} AND o2."paidAt" < ${to})
            AND o."paidAt" IS NOT NULL AND o."paidAt" < ${to} ${f} GROUP BY o."customerId" HAVING count(*) >= 2) x) AS repeat_buyers,
        (SELECT count(DISTINCT o."merchantId") FROM orders o WHERE o."paidAt" >= ${new Date(from.getTime() - (to.getTime() - from.getTime()))} AND o."paidAt" < ${from} ${f}) AS prev_active,
        (SELECT count(DISTINCT o."merchantId") FROM orders o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} ${f}
            AND o."merchantId" IN (SELECT o3."merchantId" FROM orders o3 WHERE o3."paidAt" >= ${new Date(from.getTime() - (to.getTime() - from.getTime()))} AND o3."paidAt" < ${from})) AS retained`;

    const ev = await this.prisma.analyticsEvent.groupBy({
      by: ['type'],
      where: { createdAt: { gte: from, lt: to }, ...(merchantId ? { merchantId } : {}) },
      _count: true,
    });
    const evCount = (t: AnalyticsEventType) => ev.find((e) => e.type === t)?._count ?? 0;
    const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

    const revenue = n(orders.revenue);
    const retainedDelivery = n(orders.delivery_retained);
    const providerFees = n(orders.provider_fees);
    const logistics = n(orders.logistics_costs);
    const incompleteReasons: string[] = [];
    if (n(orders.provider_fee_unknown) > 0) incompleteReasons.push(`${n(orders.provider_fee_unknown)} payment(s) without a recorded provider fee`);
    if (n(orders.logistics_unknown) > 0) incompleteReasons.push(`${n(orders.logistics_unknown)} platform-coordinated deliveries without a recorded logistics cost`);
    const searches = segment ? null : evCount('SEARCH');
    const clicks = segment ? null : evCount('SEARCH_RESULT_CLICK');

    return {
      ordersInitiated: n(orders.initiated),
      paidOrders: n(orders.paid),
      ordersCompleted: n(orders.completed),
      ordersCancelled: n(orders.cancelled),
      failedPayments: n(extra.failed_payments),
      gmvMinor: n(orders.gmv),
      platformRevenueMinor: revenue,
      deliveryFeesRetainedMinor: retainedDelivery,
      refundsMinor: n(extra.refunds),
      refundCount: n(extra.refund_count),
      providerFeesMinor: providerFees,
      logisticsCostsMinor: logistics,
      contributionMarginMinor: revenue + retainedDelivery - providerFees - logistics,
      contributionMarginComplete: incompleteReasons.length === 0,
      contributionMarginNotes: incompleteReasons,
      checkoutConversion: n(orders.initiated) ? n(orders.paid) / n(orders.initiated) : null,
      productViews: segment ? null : evCount('PRODUCT_VIEW'),
      searches,
      searchToProductRate: searches ? (clicks ?? 0) / searches : null,
      activeMerchants: n(orders.active_merchants),
      merchantRetention: n(extra.prev_active) ? n(extra.retained) / n(extra.prev_active) : null,
      repeatPurchaseRate: n(extra.buyers) ? n(extra.repeat_buyers) / n(extra.buyers) : null,
      disputesOpened: n(extra.disputes),
      failedDeliveryAttempts: n(extra.failed_attempts),
      ordersDelivered: n(orders.delivered),
      avgHoursPaidToDelivered: orders.avg_hours_to_delivery,
    };
  }

  private async merchantCounts() {
    const rows = await this.prisma.$queryRaw<{ segment: string; status: string; count: bigint }[]>`
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM market_affiliations a JOIN markets mk ON mk.id = a."marketId" WHERE a."merchantId" = m.id AND a.status = 'APPROVED' AND mk.slug = 'galaxy-mall') THEN 'GALAXY_MALL'
          WHEN EXISTS (SELECT 1 FROM market_affiliations a WHERE a."merchantId" = m.id AND a.status = 'APPROVED') THEN 'OTHER_MARKET'
          WHEN m.type = 'HOME_VENDOR' THEN 'HOME_VENDOR'
          ELSE 'INDEPENDENT'
        END AS segment,
        m.status::text AS status, count(*) AS count
      FROM merchants m GROUP BY 1, 2`;
    const out: Record<string, { registered: number; submitted: number; approved: number; suspended: number }> = {};
    for (const seg of ['ALL', ...SEGMENTS]) out[seg] = { registered: 0, submitted: 0, approved: 0, suspended: 0 };
    for (const r of rows) {
      for (const seg of ['ALL', r.segment]) {
        const c = Number(r.count);
        out[seg].registered += c;
        if (r.status !== 'DRAFT') out[seg].submitted += c;
        if (r.status === 'APPROVED') out[seg].approved += c;
        if (r.status === 'SUSPENDED') out[seg].suspended += c;
      }
    }
    const customers = await this.prisma.customerProfile.count();
    return { bySegment: out, registeredCustomers: customers };
  }
}
