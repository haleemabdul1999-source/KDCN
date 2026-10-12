/**
 * Scenario G — The platform reports paid order volumes, GMV, platform revenue and operating
 * indicators separately for Galaxy Mall, home-vendor and independent merchants.
 */
import { MerchantType, OperatorRole } from '@prisma/client';
import { Client, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder, payOrder } from '../flows';

describe('Scenario G — operational reporting by segment', () => {
  let ctx: TestCtx;
  let staff: Client;
  let operator: Client;

  beforeAll(async () => {
    ctx = await setupApp();
    staff = await staffClient(ctx);
    const op = await registerCustomer(ctx.app);
    await ctx.prisma.marketOperatorMember.create({
      data: { marketId: ctx.ref.galaxy.id, userId: op.userId, role: OperatorRole.MARKET_ADMIN },
    });
    operator = op.client;
    const cats = await categoryMap(ctx);
    const neutral = await ctx.prisma.collectionPoint.findFirstOrThrow({
      where: { marketId: null },
    });

    const mall = await onboardMerchant(ctx, staff, operator, {
      type: MerchantType.MALL_RETAILER,
      name: 'Mall Co',
      galaxy: true,
      fulfilment: [{ method: 'IN_STORE_COLLECTION' }],
    });
    const home = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.HOME_VENDOR,
      name: 'Home Co',
      serviceAreas: [{ areaName: 'Barnawa', deliveryFeeMinor: 50000 }],
      fulfilment: [
        { method: 'MERCHANT_DELIVERY' },
        { method: 'COLLECTION_POINT', collectionPointId: neutral.id },
      ],
    });
    const ind = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.INDEPENDENT_SHOP,
      name: 'Indie Co',
      fulfilment: [{ method: 'IN_STORE_COLLECTION' }],
    });
    await onboardMerchant(ctx, staff, null, {
      type: MerchantType.INDEPENDENT_SHOP,
      name: 'Never Sold',
      fulfilment: [{ method: 'IN_STORE_COLLECTION' }],
      approve: false,
    });

    const lm = await createListing(
      mall.owner,
      mall.merchantId,
      {
        title: 'Mall item',
        categorySlug: 'decor',
        stockMode: 'TRACKED',
        price: 1000000,
        quantity: 50,
      },
      cats,
    );
    const lh = await createListing(
      home.owner,
      home.merchantId,
      {
        title: 'Home item',
        categorySlug: 'decor',
        stockMode: 'TRACKED',
        price: 200000,
        quantity: 50,
      },
      cats,
    );
    const li = await createListing(
      ind.owner,
      ind.merchantId,
      {
        title: 'Indie item',
        categorySlug: 'decor',
        stockMode: 'TRACKED',
        price: 500000,
        quantity: 50,
      },
      cats,
    );
    const { client: c } = await registerCustomer(ctx.app);

    // Galaxy: 2 paid orders, 1 unpaid.
    for (let i = 0; i < 2; i++)
      await payOrder(
        c,
        (
          await placeOrder(c, lm.variants[0].id, mall.merchantId, {
            fulfilmentMethod: 'IN_STORE_COLLECTION',
          })
        ).id,
      );
    await placeOrder(c, lm.variants[0].id, mall.merchantId, {
      fulfilmentMethod: 'IN_STORE_COLLECTION',
    });
    // Home: 1 paid with merchant delivery (qty 3), 1 failed payment.
    await payOrder(
      c,
      (
        await placeOrder(
          c,
          lh.variants[0].id,
          home.merchantId,
          {
            fulfilmentMethod: 'MERCHANT_DELIVERY',
            deliveryAreaId: ctx.ref.areas['Barnawa'],
            deliveryAddress: '1 Test Road',
          },
          3,
        )
      ).id,
    );
    await payOrder(
      c,
      (
        await placeOrder(c, lh.variants[0].id, home.merchantId, {
          fulfilmentMethod: 'COLLECTION_POINT',
          collectionPointId: neutral.id,
        })
      ).id,
      'failed',
    );
    // Independent: 1 paid then cancelled by customer → full refund.
    const io = await placeOrder(c, li.variants[0].id, ind.merchantId, {
      fulfilmentMethod: 'IN_STORE_COLLECTION',
    });
    await payOrder(c, io.id);
    await c.post(`/orders/${io.id}/cancel`, { reason: 'Changed my mind' });
    // Discovery events.
    const anon = new Client(ctx.app);
    await anon.post('/analytics/events', { type: 'SEARCH', query: 'item', resultCount: 3 });
    await anon.post('/analytics/events', { type: 'SEARCH', query: 'mall', resultCount: 1 });
    await anon.post('/analytics/events', { type: 'SEARCH_RESULT_CLICK', listingId: lm.id });
    await anon.post('/analytics/events', { type: 'PRODUCT_VIEW', listingId: lm.id });
  });
  afterAll(() => ctx.app.close());

  it('reports accurate per-segment volumes, GMV and revenue', async () => {
    const res = await staff.get('/admin/analytics');
    expect(res.status).toBe(200);
    const s = res.body.segments;

    expect(s.GALAXY_MALL).toMatchObject({
      ordersInitiated: 3,
      paidOrders: 2,
      gmvMinor: 2_000_000,
      platformRevenueMinor: 2 * (45_000 + 10_000), // 4.5% Galaxy rule + ₦100 service fee
      refundsMinor: 0,
    });
    expect(s.GALAXY_MALL.checkoutConversion).toBeCloseTo(2 / 3);

    expect(s.HOME_VENDOR).toMatchObject({
      ordersInitiated: 2,
      paidOrders: 1,
      gmvMinor: 600_000,
      platformRevenueMinor: 24_000 + 10_000, // 4% home-vendor rule
      deliveryFeesRetainedMinor: 0, // merchant-delivered: fee belongs to merchant
      failedPayments: 1,
    });

    expect(s.INDEPENDENT).toMatchObject({
      paidOrders: 1,
      gmvMinor: 500_000, // GMV is before refunds
      platformRevenueMinor: 0, // fully refunded → no revenue
      refundsMinor: 510_000,
      refundCount: 1,
    });

    expect(s.ALL.paidOrders).toBe(4);
    expect(s.ALL.gmvMinor).toBe(3_100_000);
    expect(s.ALL.activeMerchants).toBe(3);
    // Provider fees are known for mock payments, so contribution margin is complete here.
    expect(s.ALL.providerFeesMinor).toBeGreaterThan(0);
    expect(s.ALL.contributionMarginComplete).toBe(true);
    expect(s.ALL.contributionMarginMinor).toBe(
      s.ALL.platformRevenueMinor +
        s.ALL.deliveryFeesRetainedMinor -
        s.ALL.providerFeesMinor -
        s.ALL.logisticsCostsMinor,
    );
    expect(s.ALL.searches).toBe(2);
    expect(s.ALL.searchToProductRate).toBeCloseTo(0.5);

    const merchants = res.body.merchants.bySegment;
    expect(merchants.GALAXY_MALL.approved).toBe(1);
    expect(merchants.HOME_VENDOR.approved).toBe(1);
    expect(merchants.INDEPENDENT).toMatchObject({ registered: 2, submitted: 2, approved: 1 });
  });

  it('marks contribution margin incomplete when costs are unknown', async () => {
    await ctx.prisma.paymentTransaction.updateMany({
      where: { status: 'SUCCEEDED' },
      data: { providerFeeMinor: null },
    });
    const res = await staff.get('/admin/analytics');
    expect(res.body.segments.ALL.contributionMarginComplete).toBe(false);
    expect(res.body.segments.ALL.contributionMarginNotes[0]).toMatch(
      /without a recorded provider fee/,
    );
  });

  it('gives market operators aggregate figures for their market only', async () => {
    const res = await operator.get(`/operator/${ctx.ref.galaxy.id}`);
    expect(res.body.metrics).toMatchObject({
      approvedMerchants: 1,
      paidOrders: 2,
      gmvMinor: 2_000_000,
      transactingMerchants: 1,
    });
  });
});
