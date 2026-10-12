/**
 * Scenario A — Galaxy Mall retailer: registers, is approved, uploads products, appears in
 * Galaxy Mall search, receives an order, confirms availability, receives a verified test
 * payment and completes a collection transaction.
 */
import { MerchantType, OperatorRole } from '@prisma/client';
import { Client, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder, payOrder } from '../flows';

describe('Scenario A — Galaxy Mall retailer', () => {
  let ctx: TestCtx;
  let staff: Client;
  let operator: Client;

  beforeAll(async () => {
    ctx = await setupApp();
    staff = await staffClient(ctx);
    const op = await registerCustomer(ctx.app, 'Galaxy Ops');
    await ctx.prisma.marketOperatorMember.create({
      data: { marketId: ctx.ref.galaxy.id, userId: op.userId, role: OperatorRole.MARKET_ADMIN },
    });
    operator = op.client;
  });
  afterAll(() => ctx.app.close());

  it('completes onboarding → listing → mall search → order → confirmation → verified payment → collection', async () => {
    const desk = await ctx.prisma.collectionPoint.findFirstOrThrow({
      where: { marketId: ctx.ref.galaxy.id },
    });
    const { owner, merchantId } = await onboardMerchant(ctx, staff, operator, {
      type: MerchantType.MALL_RETAILER,
      name: 'Galaxy Shoes',
      galaxy: true,
      fulfilment: [
        { method: 'IN_STORE_COLLECTION' },
        { method: 'COLLECTION_POINT', collectionPointId: desk.id },
      ],
    });
    const m = await ctx.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    expect(m.status).toBe('APPROVED');

    const cats = await categoryMap(ctx);
    const listing = await createListing(
      owner,
      merchantId,
      {
        title: 'Leather loafers',
        categorySlug: 'shoes-bags',
        stockMode: 'CONFIRM_ON_ORDER',
        price: 2500000,
      },
      cats,
    );

    // Appears in Galaxy Mall–scoped search and on the Galaxy Mall page.
    const anon = new Client(ctx.app);
    const search = await anon.get('/search?q=loafers&market=galaxy-mall');
    expect(search.status).toBe(200);
    expect(search.body.items.map((i: { id: string }) => i.id)).toContain(listing.id);
    const mall = await anon.get('/markets/galaxy-mall');
    expect(mall.body.merchants.map((x: { id: string }) => x.id)).toContain(merchantId);

    // Customer orders for in-store collection.
    const { client: customer } = await registerCustomer(ctx.app);
    const order = await placeOrder(customer, listing.variants[0].id, merchantId, {
      fulfilmentMethod: 'IN_STORE_COLLECTION',
    });
    expect(order.status).toBe('PENDING_MERCHANT_CONFIRMATION');
    expect(order.totalMinor).toBe(2500000 + 10000); // goods + ₦100 service fee

    // Cannot pay before the merchant confirms availability.
    expect((await customer.post(`/orders/${order.id}/pay`)).status).toBe(409);

    // Merchant confirms availability.
    const confirmed = await owner.post(`/merchant/${merchantId}/orders/${order.id}/confirm`, {
      note: 'In stock in size 42',
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('AWAITING_PAYMENT');
    // Customer contact is withheld from the merchant until payment.
    expect(confirmed.body.customer.phone).toBeNull();

    // Verified test payment.
    const pay = await payOrder(customer, order.id);
    expect(pay.verify.order.status).toBe('PAID');
    expect(pay.verify.order.payments[0].testMode).toBe(true);
    const settlement = await ctx.prisma.settlementAllocation.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(settlement.grossMinor).toBe(2500000);
    expect(settlement.commissionMinor).toBe(112500); // Galaxy Mall market rule 4.5%
    expect(settlement.merchantNetMinor).toBe(2500000 - 112500);
    expect(settlement.status).toBe('PENDING_FULFILMENT');

    // Fulfilment: accept → preparing → ready.
    for (const action of ['accept', 'preparing', 'ready']) {
      const r = await owner.post(`/merchant/${merchantId}/orders/${order.id}/${action}`);
      expect(r.status).toBe(200);
    }
    const view = await customer.get(`/orders/${order.id}`);
    expect(view.body.status).toBe('READY_FOR_COLLECTION');
    const code: string = view.body.fulfilment.collectionCode;
    expect(code).toMatch(/^\d{6}$/);

    // Wrong code rejected; correct code completes the collection.
    const wrong = await owner.post(`/merchant/${merchantId}/orders/${order.id}/collected`, {
      code: code === '000000' ? '111111' : '000000',
    });
    expect(wrong.status).toBe(400);
    const collected = await owner.post(`/merchant/${merchantId}/orders/${order.id}/collected`, {
      code,
    });
    expect(collected.status).toBe(200);
    expect(collected.body.status).toBe('COMPLETED');
    expect(
      (await ctx.prisma.settlementAllocation.findUniqueOrThrow({ where: { orderId: order.id } }))
        .status,
    ).toBe('ELIGIBLE');

    // Finance records the payout.
    const settled = await staff.post('/admin/settlements/mark-settled', {
      settlementIds: [settlement.id],
      payoutReference: 'TRF-0001',
    });
    expect(settled.status).toBe(200);
    const merchantSettlements = await owner.get(`/merchant/${merchantId}/settlements`);
    expect(merchantSettlements.body.items[0]).toMatchObject({
      status: 'SETTLED',
      payoutReference: 'TRF-0001',
    });

    // Timeline records every step.
    const events = await ctx.prisma.orderEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.toStatus)).toEqual([
      'DRAFT',
      'PENDING_MERCHANT_CONFIRMATION',
      'AWAITING_PAYMENT',
      'PAYMENT_PENDING_VERIFICATION',
      'PAID',
      'ACCEPTED_FOR_FULFILMENT',
      'PREPARING',
      'READY_FOR_COLLECTION',
      'DELIVERED',
      'COMPLETED',
    ]);
  });

  it('restricts the Galaxy Mall collection desk to approved Galaxy merchants', async () => {
    const desk = await ctx.prisma.collectionPoint.findFirstOrThrow({
      where: { marketId: ctx.ref.galaxy.id },
    });
    const { client } = await registerCustomer(ctx.app);
    const m = await client.post('/merchants', {
      displayName: 'Outsider',
      type: 'INDEPENDENT_SHOP',
      contactEmail: 'o@test.kdcn.ng',
      contactPhone: '08035550001',
      publicAreaId: ctx.ref.areas['Kawo'],
    });
    const res = await client.put(`/merchant/${m.body.id}/fulfilment-options`, {
      options: [{ method: 'COLLECTION_POINT', enabled: true, collectionPointId: desk.id }],
    });
    expect(res.status).toBe(403);
  });
});
