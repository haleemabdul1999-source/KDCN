/**
 * Scenario D — Merchant isolation: a merchant cannot retrieve or modify another merchant's
 * private products, orders, settlements or customer information.
 */
import { MerchantType, OperatorRole } from '@prisma/client';
import { Client, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder, payOrder } from '../flows';

describe('Scenario D — merchant isolation and object-level authorisation', () => {
  let ctx: TestCtx;
  let a: Awaited<ReturnType<typeof onboardMerchant>>;
  let b: Awaited<ReturnType<typeof onboardMerchant>>;
  let listingA: { id: string; variants: { id: string }[] };
  let orderA: { id: string };
  let customer: Client;
  let operator: Client;

  beforeAll(async () => {
    ctx = await setupApp();
    const staff = await staffClient(ctx);
    a = await onboardMerchant(ctx, staff, null, { type: MerchantType.INDEPENDENT_SHOP, name: 'Shop A', fulfilment: [{ method: 'IN_STORE_COLLECTION' }] });
    b = await onboardMerchant(ctx, staff, null, { type: MerchantType.INDEPENDENT_SHOP, name: 'Shop B', fulfilment: [{ method: 'IN_STORE_COLLECTION' }] });
    const cats = await categoryMap(ctx);
    listingA = await createListing(a.owner, a.merchantId, { title: 'Secret draft item', categorySlug: 'kitchen', stockMode: 'TRACKED', price: 100000, quantity: 3 }, cats);
    customer = (await registerCustomer(ctx.app)).client;
    orderA = await placeOrder(customer, listingA.variants[0].id, a.merchantId, { fulfilmentMethod: 'IN_STORE_COLLECTION' });
    await payOrder(customer, orderA.id);
    const op = await registerCustomer(ctx.app);
    await ctx.prisma.marketOperatorMember.create({ data: { marketId: ctx.ref.galaxy.id, userId: op.userId, role: OperatorRole.MARKET_EDITOR } });
    operator = op.client;
  });
  afterAll(() => ctx.app.close());

  it("merchant B cannot reach merchant A's private resources via A's merchantId", async () => {
    const base = `/merchant/${a.merchantId}`;
    const attempts = [
      b.owner.get(base),
      b.owner.get(`${base}/listings`),
      b.owner.get(`${base}/listings/${listingA.id}`),
      b.owner.patch(`${base}/listings/${listingA.id}`, { title: 'Hijacked' }),
      b.owner.get(`${base}/orders`),
      b.owner.get(`${base}/orders/${orderA.id}`),
      b.owner.post(`${base}/orders/${orderA.id}/accept`),
      b.owner.get(`${base}/settlements`),
      b.owner.get(`${base}/analytics`),
      b.owner.put(`${base}/payout`, { bankCode: '058', accountNumber: '9999999999', accountName: 'Thief' }),
      b.owner.get(`${base}/members`),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
  });

  it("merchant B cannot reach A's objects by substituting IDs under its own merchantId", async () => {
    const base = `/merchant/${b.merchantId}`;
    expect((await b.owner.get(`${base}/listings/${listingA.id}`)).status).toBe(404);
    expect((await b.owner.patch(`${base}/listings/${listingA.id}`, { title: 'Hijacked' })).status).toBe(404);
    expect((await b.owner.put(`${base}/listings/${listingA.id}/inventory/${listingA.variants[0].id}`, { quantity: 0 })).status).toBe(404);
    expect((await b.owner.get(`${base}/orders/${orderA.id}`)).status).toBe(404);
    expect((await b.owner.post(`${base}/orders/${orderA.id}/accept`)).status).toBe(404);
    expect((await b.owner.post(`${base}/orders/${orderA.id}/cancel`, { reason: 'sabotage' })).status).toBe(404);
    const listed = await b.owner.get(`${base}/orders`);
    expect(listed.body.items).toHaveLength(0);
    const s = await b.owner.get(`${base}/settlements`);
    expect(s.body.items).toHaveLength(0);
    // Nothing changed.
    const fresh = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderA.id } });
    expect(fresh.status).toBe('PAID');
    expect((await ctx.prisma.product.findFirstOrThrow({ where: { listings: { some: { id: listingA.id } } } })).title).toBe('Secret draft item');
  });

  it('customers cannot read other customers orders; anonymous users need the guest token', async () => {
    const other = (await registerCustomer(ctx.app)).client;
    expect((await other.get(`/orders/${orderA.id}`)).status).toBe(404);
    expect((await other.post(`/orders/${orderA.id}/cancel`)).status).toBe(404);
    const anon = new Client(ctx.app);
    expect((await anon.get(`/orders/${orderA.id}`)).status).toBe(400);
    anon.orderToken = 'not-a-valid-token-xxxxxxxx';
    expect((await anon.get(`/orders/${orderA.id}`)).status).toBe(404);
  });

  it('staff roles are separated and require MFA; non-staff cannot use admin APIs', async () => {
    expect((await customer.get('/admin/orders')).status).toBe(403);
    expect((await operator.get('/admin/merchants')).status).toBe(403);
    const support = await staffClient(ctx, ['SUPPORT']);
    expect((await support.get('/admin/disputes')).status).toBe(200);
    expect((await support.get('/admin/settlements')).status).toBe(403);
    expect((await support.post(`/admin/merchants/${a.merchantId}/suspend`, { note: 'nope nope' })).status).toBe(403);
  });

  it('market operators see only aggregate, public information', async () => {
    const res = await operator.get(`/operator/${ctx.ref.galaxy.id}/merchants`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const forbidden of ['payout', 'contactEmail', 'privateAddress', 'customer']) expect(text).not.toContain(forbidden);
    // Editors cannot approve affiliations.
    expect((await operator.post(`/operator/${ctx.ref.galaxy.id}/affiliations/00000000-0000-0000-0000-000000000000/approve`)).status).toBe(403);
    // Operators cannot read another market.
    const other = await ctx.prisma.market.findFirstOrThrow({ where: { slug: 'kaduna-central-market' } });
    expect((await operator.get(`/operator/${other.id}`)).status).toBe(404);
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await b.owner.agent.post(`/api/merchant/${b.merchantId}/listings`).send({});
    expect(res.status).toBe(403);
  });
});
