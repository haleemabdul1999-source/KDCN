/**
 * Scenario H — The platform behaves safely when merchant confirmation fails, payment providers
 * become unavailable, delivery cannot be completed or the customer requests a cancellation.
 */
import { MerchantType } from '@prisma/client';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock.provider';
import { Client, idemKey, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder, payOrder } from '../flows';

describe('Scenario H — failure handling', () => {
  let ctx: TestCtx;
  let staff: Client;
  let shop: Awaited<ReturnType<typeof onboardMerchant>>;
  let tracked: { id: string; variants: { id: string }[] };
  let confirm: { id: string; variants: { id: string }[] };
  let customer: Client;

  const inventory = () => ctx.prisma.inventory.findUniqueOrThrow({ where: { listingVariantId: tracked.variants[0].id } });
  const runJob = (name: string) => ctx.app.get(JobsService).runJob(name);

  beforeAll(async () => {
    ctx = await setupApp();
    staff = await staffClient(ctx);
    shop = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.INDEPENDENT_SHOP,
      name: 'Fragile Shop',
      serviceAreas: [{ areaName: 'Kawo', deliveryFeeMinor: 60000 }],
      fulfilment: [{ method: 'IN_STORE_COLLECTION' }, { method: 'MERCHANT_DELIVERY' }],
    });
    const cats = await categoryMap(ctx);
    tracked = await createListing(shop.owner, shop.merchantId, { title: 'Last lamp', categorySlug: 'decor', stockMode: 'TRACKED', price: 700000, quantity: 1 }, cats);
    confirm = await createListing(shop.owner, shop.merchantId, { title: 'Rug on request', categorySlug: 'decor', stockMode: 'CONFIRM_ON_ORDER', price: 900000 }, cats);
    customer = (await registerCustomer(ctx.app)).client;
  });
  afterAll(() => {
    MockPaymentProvider.unavailable = false;
    return ctx.app.close();
  });

  it('two customers racing for the last unit: exactly one order is placed', async () => {
    const c1 = (await registerCustomer(ctx.app)).client;
    const c2 = (await registerCustomer(ctx.app)).client;
    for (const c of [c1, c2]) await c.post('/cart/items', { listingVariantId: tracked.variants[0].id, quantity: 1 });
    const results = await Promise.all(
      [c1, c2].map((c) => c.post('/checkout/place', { merchantId: shop.merchantId, fulfilmentMethod: 'IN_STORE_COLLECTION', acceptTerms: true }).set('Idempotency-Key', idemKey())),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('OUT_OF_STOCK');
    expect(await inventory()).toMatchObject({ quantity: 1, reserved: 1 });
    // Out-of-stock purchase attempts are refused at the cart too.
    expect((await customer.post('/cart/items', { listingVariantId: tracked.variants[0].id, quantity: 1 })).status).toBe(400);

    // The winner cancels before paying → the reservation is released.
    const winner = results.find((r) => r.status === 201)!;
    const who = results[0].status === 201 ? c1 : c2;
    const cancelled = await who.post(`/orders/${winner.body.order.id}/cancel`, { reason: 'Found it cheaper' });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await inventory()).toMatchObject({ quantity: 1, reserved: 0 });
  });

  it('a retried checkout with the same Idempotency-Key returns the same order', async () => {
    const key = idemKey();
    await customer.post('/cart/items', { listingVariantId: confirm.variants[0].id, quantity: 1 });
    const body = { merchantId: shop.merchantId, fulfilmentMethod: 'IN_STORE_COLLECTION', acceptTerms: true };
    const first = await customer.post('/checkout/place', body).set('Idempotency-Key', key);
    const second = await customer.post('/checkout/place', body).set('Idempotency-Key', key);
    expect(first.status).toBe(201);
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(second.body.replayed).toBe(true);
    const reuse = await customer.post('/checkout/place', { ...body, customerNote: 'different' }).set('Idempotency-Key', key);
    expect(reuse.status).toBe(409);
    await customer.post(`/orders/${first.body.order.id}/cancel`);
  });

  it('merchant declines availability → order cancelled, customer not charged', async () => {
    const order = await placeOrder(customer, confirm.variants[0].id, shop.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });
    const r = await shop.owner.post(`/merchant/${shop.merchantId}/orders/${order.id}/reject`, { reason: 'Sold out of this size' });
    expect(r.body.status).toBe('CANCELLED');
    const v = await customer.get(`/orders/${order.id}`);
    expect(v.body.cancellationReason).toMatch(/Sold out/);
    expect(v.body.actions.canPay).toBe(false);
    expect(await ctx.prisma.paymentTransaction.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('merchant never confirms → order expires automatically', async () => {
    const order = await placeOrder(customer, confirm.variants[0].id, shop.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });
    await ctx.prisma.order.update({ where: { id: order.id }, data: { confirmationDeadline: new Date(Date.now() - 1000) } });
    expect(await runJob('orders.expire_confirmations')).toBeGreaterThanOrEqual(1);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
  });

  it('payment provider outage: order stays payable and payment succeeds once restored', async () => {
    const order = await placeOrder(customer, tracked.variants[0].id, shop.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });
    MockPaymentProvider.unavailable = true;
    const res = await customer.post(`/orders/${order.id}/pay`);
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/temporarily unavailable/);
    expect((await customer.get(`/orders/${order.id}`)).body).toMatchObject({ status: 'AWAITING_PAYMENT', actions: { canPay: true } });
    MockPaymentProvider.unavailable = false;
    expect((await payOrder(customer, order.id)).verify.order.status).toBe('PAID');
    expect(await inventory()).toMatchObject({ quantity: 0, reserved: 0 }); // stock committed
    // Customer cancels after payment (before acceptance) → full refund.
    const c = await customer.post(`/orders/${order.id}/cancel`, { reason: 'Ordered by mistake' });
    expect(c.body.status).toBe('REFUNDED');
    expect(c.body.refundedMinor).toBe(c.body.totalMinor);
    expect((await ctx.prisma.settlementAllocation.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe('REVERSED');
    // A second cancellation cannot double-refund.
    expect((await customer.post(`/orders/${order.id}/cancel`)).status).toBe(409);
    expect(await ctx.prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('unpaid orders expire after the payment window; a late payment is refunded automatically', async () => {
    await ctx.prisma.inventory.update({ where: { listingVariantId: tracked.variants[0].id }, data: { quantity: 5 } });
    const order = await placeOrder(customer, tracked.variants[0].id, shop.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });
    const init = await customer.post(`/orders/${order.id}/pay`);
    await ctx.prisma.order.update({ where: { id: order.id }, data: { paymentDeadline: new Date(Date.now() - 3600_000) } });
    await runJob('orders.expire_payments');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect((await inventory()).reserved).toBe(0);
    // Customer completes payment on the provider page after cancellation.
    const late = await customer.post(`/payments/mock/${init.body.reference}/complete`, { outcome: 'success' });
    expect(late.body.webhookResult).toBe('late_payment_refund_raised');
    await runJob('refunds.process');
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { orderId: order.id } });
    expect(refund.status).toBe('SUCCEEDED');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
  });

  it('failed delivery returns the order for re-dispatch; repeated failure ends in cancellation with refund', async () => {
    const order = await placeOrder(customer, tracked.variants[0].id, shop.merchantId, { fulfilmentMethod: 'MERCHANT_DELIVERY', deliveryAreaId: ctx.ref.areas['Kawo'], deliveryAddress: '9 Kawo Close' });
    await payOrder(customer, order.id);
    const base = `/merchant/${shop.merchantId}/orders/${order.id}`;
    await shop.owner.post(`${base}/accept`);
    await shop.owner.post(`${base}/preparing`);
    for (let i = 1; i <= 3; i++) {
      expect((await shop.owner.post(`${base}/dispatch`, { partnerName: 'Rider' })).body.status).toBe('DISPATCHED');
      const failed = await shop.owner.post(`${base}/delivery-failed`, { note: 'Customer unreachable' });
      expect(failed.body.status).toBe('PREPARING');
      expect(failed.body.fulfilment.failedAttempts).toBe(i);
    }
    // Ready-for-collection is not valid for a delivery order.
    expect((await shop.owner.post(`${base}/ready`)).status).toBe(400);
    const cancelled = await shop.owner.post(`${base}/cancel`, { reason: 'Could not deliver after 3 attempts' });
    expect(cancelled.body.status).toBe('REFUNDED');
    const cv = await customer.get(`/orders/${order.id}`);
    expect(cv.body.fulfilment.events.filter((e: { type: string }) => e.type === 'FAILED_ATTEMPT')).toHaveLength(3);
  });

  it('refund provider outage leaves the refund queued and the job completes it later', async () => {
    const order = await placeOrder(customer, tracked.variants[0].id, shop.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });
    await payOrder(customer, order.id);
    MockPaymentProvider.unavailable = true;
    const c = await customer.post(`/orders/${order.id}/cancel`);
    expect(c.body.status).toBe('REFUND_PENDING');
    expect((await ctx.prisma.refund.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('APPROVED');
    MockPaymentProvider.unavailable = false;
    await runJob('refunds.process');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');
  });

  it('rejects invalid state transitions', async () => {
    const order = await placeOrder(customer, confirm.variants[0].id, shop.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });
    const base = `/merchant/${shop.merchantId}/orders/${order.id}`;
    for (const a of ['accept', 'preparing', 'ready', 'delivered']) {
      const r = await shop.owner.post(`${base}/${a}`);
      expect(r.status).toBe(409);
    }
    expect((await customer.post(`/orders/${order.id}/confirm-receipt`)).status).toBe(409);
    // Concurrent double-confirm: one wins, one conflicts.
    const both = await Promise.all([shop.owner.post(`${base}/confirm`), shop.owner.post(`${base}/confirm`)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await ctx.prisma.orderEvent.count({ where: { orderId: order.id, toStatus: 'AWAITING_PAYMENT' } })).toBe(1);
  });

  it('guest checkout works with a tracking token and never exposes the order without it', async () => {
    const guest = new Client(ctx.app);
    await guest.post('/cart/items', { listingVariantId: confirm.variants[0].id, quantity: 1 });
    const res = await guest.post('/checkout/place', { merchantId: shop.merchantId, fulfilmentMethod: 'IN_STORE_COLLECTION', acceptTerms: true, guestEmail: 'guest@test.kdcn.ng', guestPhone: '08030001111', guestName: 'Guest Person' }).set('Idempotency-Key', idemKey());
    expect(res.status).toBe(201);
    const token = res.body.guestAccessToken;
    expect(token).toBeTruthy();
    const tracked = await new Client(ctx.app).post('/orders/track', { number: res.body.order.number, token });
    expect(tracked.body.id).toBe(res.body.order.id);
    expect((await new Client(ctx.app).post('/orders/track', { number: res.body.order.number, token: 'x'.repeat(30) })).status).toBe(404);
  });
});
