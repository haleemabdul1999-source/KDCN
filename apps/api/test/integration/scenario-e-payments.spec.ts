/**
 * Scenario E — Payment reliability: duplicated webhooks cannot create duplicate financial
 * records or mark unrelated orders paid; failed payments do not produce completed orders.
 */
import { MerchantType } from '@prisma/client';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock.provider';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { Client, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder, payOrder } from '../flows';

describe('Scenario E — payment reliability', () => {
  let ctx: TestCtx;
  let merchant: Awaited<ReturnType<typeof onboardMerchant>>;
  let variantId: string;
  let customer: Client;

  const webhook = (event: string, data: object, tamper = false) => {
    const { body, headers } = MockPaymentProvider.signedWebhook(event, data);
    const req = new Client(ctx.app).agent.post('/api/payments/webhooks/mock').set('content-type', 'application/json');
    for (const [k, v] of Object.entries(headers)) req.set(k, tamper && k === 'x-mock-signature' ? v.replace(/^./, v[0] === 'a' ? 'b' : 'a') : v);
    return req.send(body.toString());
  };

  beforeAll(async () => {
    ctx = await setupApp();
    const staff = await staffClient(ctx);
    merchant = await onboardMerchant(ctx, staff, null, { type: MerchantType.INDEPENDENT_SHOP, name: 'Pay Shop', fulfilment: [{ method: 'IN_STORE_COLLECTION' }] });
    const cats = await categoryMap(ctx);
    variantId = (await createListing(merchant.owner, merchant.merchantId, { title: 'Kettle', categorySlug: 'kitchen', stockMode: 'TRACKED', price: 1000000, quantity: 100 }, cats)).variants[0].id;
    customer = (await registerCustomer(ctx.app)).client;
  });
  afterAll(() => ctx.app.close());

  const newOrder = () => placeOrder(customer, variantId, merchant.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });

  it('a duplicated webhook is recorded once and creates exactly one financial record', async () => {
    const order = await newOrder();
    expect(order.status).toBe('AWAITING_PAYMENT'); // tracked stock: no confirmation step
    const init = await customer.post(`/orders/${order.id}/pay`);
    const ref = init.body.reference;
    await customer.post(`/payments/mock/${ref}/complete`, { outcome: 'success', sendWebhook: false });

    const results = [];
    for (let i = 0; i < 3; i++) results.push(await webhook('charge.success', { reference: ref }));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.map((r) => r.body.result)).toEqual(['paid', 'duplicate_ignored', 'duplicate_ignored']);

    const ev = await ctx.prisma.providerWebhookEvent.findMany({ where: { eventKey: `charge.success:${ref}` } });
    expect(ev).toHaveLength(1);
    expect(ev[0].deliveryCount).toBe(3);
    expect(await ctx.prisma.paymentTransaction.count({ where: { orderId: order.id, status: 'SUCCEEDED' } })).toBe(1);
    expect(await ctx.prisma.settlementAllocation.count({ where: { orderId: order.id } })).toBe(1);
    expect(await ctx.prisma.orderEvent.count({ where: { orderId: order.id, toStatus: 'PAID' } })).toBe(1);
    // A later redirect verification is a no-op.
    expect((await customer.post(`/orders/${order.id}/verify-payment`, { reference: ref })).body.outcome).toBe('already_applied');
  });

  it('concurrent verifications of the same payment apply exactly once', async () => {
    const order = await newOrder();
    const init = await customer.post(`/orders/${order.id}/pay`);
    await customer.post(`/payments/mock/${init.body.reference}/complete`, { outcome: 'success', sendWebhook: false });
    const payments = ctx.app.get(PaymentsService);
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => payments.verifyAndApply(init.body.reference, 'test').catch((e) => `error:${e.message}`)));
    expect(outcomes.filter((o) => o === 'paid')).toHaveLength(1);
    expect(outcomes.every((o) => o === 'paid' || o === 'already_applied')).toBe(true);
    expect(await ctx.prisma.orderEvent.count({ where: { orderId: order.id, toStatus: 'PAID' } })).toBe(1);
    const inv = await ctx.prisma.inventory.findUniqueOrThrow({ where: { listingVariantId: variantId } });
    expect(inv.reserved).toBe(0);
  });

  it('rejects webhooks with an invalid signature and records nothing', async () => {
    const order = await newOrder();
    const init = await customer.post(`/orders/${order.id}/pay`);
    await customer.post(`/payments/mock/${init.body.reference}/complete`, { outcome: 'success', sendWebhook: false });
    const res = await webhook('charge.success', { reference: init.body.reference }, true);
    expect(res.status).toBe(401);
    expect(await ctx.prisma.providerWebhookEvent.count({ where: { eventKey: `charge.success:${init.body.reference}` } })).toBe(0);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_PENDING_VERIFICATION');
  });

  it('a webhook cannot mark an unrelated order paid', async () => {
    const victim = await newOrder();
    const res = await webhook('charge.success', { reference: 'KDCN-FORGED-REFERENCE', orderId: victim.id, amount: 1 });
    expect(res.body.result).toBe('unknown_reference');
    // Webhook claims success for a real reference whose charge did NOT succeed: verification says otherwise.
    const init = await customer.post(`/orders/${victim.id}/pay`);
    const lie = await webhook('charge.success', { reference: init.body.reference });
    expect(lie.body.result).toBe('pending');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: victim.id } })).paidAt).toBeNull();
  });

  it('a redirect alone never marks an order paid', async () => {
    const order = await newOrder();
    const init = await customer.post(`/orders/${order.id}/pay`);
    const v = await customer.post(`/orders/${order.id}/verify-payment`, { reference: init.body.reference });
    expect(v.body.outcome).toBe('pending');
    expect(v.body.order.status).toBe('PAYMENT_PENDING_VERIFICATION');
  });

  it('failed payments return the order to awaiting payment and never complete it; retry succeeds', async () => {
    const order = await newOrder();
    const failed = await payOrder(customer, order.id, 'failed');
    expect(failed.verify.order.status).toBe('AWAITING_PAYMENT');
    expect(await ctx.prisma.settlementAllocation.count({ where: { orderId: order.id } })).toBe(0);
    const ok = await payOrder(customer, order.id, 'success');
    expect(ok.verify.order.status).toBe('PAID');
    const payments = await ctx.prisma.paymentTransaction.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(payments.map((p) => p.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('a second successful payment for an already-paid order is refunded automatically', async () => {
    const order = await newOrder();
    const first = await customer.post(`/orders/${order.id}/pay`);
    const second = await customer.post(`/orders/${order.id}/pay`); // customer opened two tabs
    await customer.post(`/payments/mock/${first.body.reference}/complete`, { outcome: 'success' });
    // The second attempt was abandoned when the first succeeded; even so, if the provider
    // still captures it, the money must be refunded, not kept.
    await ctx.prisma.paymentTransaction.update({ where: { reference: second.body.reference }, data: { status: 'PENDING' } });
    const res = await customer.post(`/payments/mock/${second.body.reference}/complete`, { outcome: 'success' });
    expect(res.body.webhookResult).toBe('duplicate_payment_refund_raised');
    const dup = await ctx.prisma.paymentTransaction.findUniqueOrThrow({ where: { reference: second.body.reference } });
    expect(dup).toMatchObject({ status: 'SUCCEEDED', isDuplicate: true });
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { paymentTransactionId: dup.id } });
    expect(refund.status).toBe('APPROVED');
    expect(refund.amountMinor).toBe(dup.amountMinor);
    // Exactly one settlement, unaffected by the duplicate.
    expect(await ctx.prisma.settlementAllocation.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('an amount mismatch is never accepted as payment', async () => {
    const order = await newOrder();
    const init = await customer.post(`/orders/${order.id}/pay`);
    const mock = new MockPaymentProvider(ctx.prisma);
    await mock.completeCharge(init.body.reference, 'success', 100); // provider captured ₦1 instead
    const v = await customer.post(`/orders/${order.id}/verify-payment`, { reference: init.body.reference });
    expect(v.body.outcome).toBe('amount_mismatch');
    expect(v.body.order.status).not.toBe('PAID');
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'payment.amount_mismatch' } })).toBe(1);
  });
});
