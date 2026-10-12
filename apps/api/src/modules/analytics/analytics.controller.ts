import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AnalyticsEventType, MerchantRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Auth, CurrentAuth, Public } from '../../common/auth/decorators';
import { AccessService } from '../../common/auth/access.service';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { parse, zId } from '../../common/validation';
import { AnalyticsService } from './analytics.service';

export const periodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export function resolvePeriod(p: z.infer<typeof periodSchema>) {
  const to = p.to ?? new Date();
  const from = p.from ?? new Date(to.getTime() - 30 * 86400_000);
  return { from, to };
}

@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
  ) {}

  /** First-party behavioural events (no IP stored; daily-rotating salted visitor hash). */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('analytics/events')
  @HttpCode(204)
  async event(@Body() body: unknown, @Req() req: KdcnRequest, @CurrentAuth() auth?: AuthContext) {
    const input = parse(
      z.object({
        type: z.nativeEnum(AnalyticsEventType),
        listingId: zId.optional(),
        merchantSlug: z.string().max(60).optional(),
        query: z.string().max(100).optional(),
        resultCount: z.number().int().min(0).max(100000).optional(),
      }),
      body,
    );
    let merchantId: string | undefined;
    if (input.listingId) {
      merchantId = (
        await this.prisma.listing.findUnique({
          where: { id: input.listingId },
          select: { merchantId: true },
        })
      )?.merchantId;
    } else if (input.merchantSlug) {
      merchantId = (
        await this.prisma.merchant.findUnique({
          where: { slug: input.merchantSlug },
          select: { id: true },
        })
      )?.id;
    }
    await this.analytics.track({
      type: input.type,
      visitorHash: this.analytics.visitorHash(req.ip, req.headers['user-agent']),
      userId: auth?.user.id,
      merchantId,
      listingId: input.listingId,
      query: input.query,
      resultCount: input.resultCount,
    });
  }

  /** Merchant's own dashboard metrics. */
  @Get('merchant/:merchantId/analytics')
  async merchant(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Query() query: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const { from, to } = resolvePeriod(parse(periodSchema, query));
    const m = await this.analytics.platformMetrics(from, to, merchantId);
    const all = (m.segments as Record<string, Record<string, unknown>>).ALL;
    const storefrontViews = await this.prisma.analyticsEvent.count({
      where: { merchantId, type: 'STOREFRONT_VIEW', createdAt: { gte: from, lt: to } },
    });
    const topListings = await this.prisma.orderItem.groupBy({
      by: ['listingId', 'productTitle'],
      where: { order: { merchantId, paidAt: { gte: from, lt: to } } },
      _sum: { quantity: true, lineTotalMinor: true },
      orderBy: { _sum: { lineTotalMinor: 'desc' } },
      take: 5,
    });
    return {
      period: { from, to },
      paidOrders: all.paidOrders,
      ordersInitiated: all.ordersInitiated,
      ordersCompleted: all.ordersCompleted,
      ordersCancelled: all.ordersCancelled,
      salesMinor: all.gmvMinor,
      commissionAndFeesMinor: all.platformRevenueMinor,
      refundsMinor: all.refundsMinor,
      productViews: all.productViews,
      storefrontViews,
      checkoutConversion: all.checkoutConversion,
      avgHoursPaidToDelivered: all.avgHoursPaidToDelivered,
      disputesOpened: all.disputesOpened,
      topListings: topListings.map((t) => ({
        listingId: t.listingId,
        title: t.productTitle,
        quantity: t._sum.quantity ?? 0,
        salesMinor: t._sum.lineTotalMinor ?? 0,
      })),
    };
  }
}
