/**
 * Scenario C — A customer searches for a product and discovers offerings from different
 * merchant categories without browsing each marketplace separately.
 */
import { MerchantType, OperatorRole } from '@prisma/client';
import { Client, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant } from '../flows';

describe('Scenario C — cross-segment discovery', () => {
  let ctx: TestCtx;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await setupApp();
    const staff = await staffClient(ctx);
    const op = await registerCustomer(ctx.app);
    await ctx.prisma.marketOperatorMember.create({ data: { marketId: ctx.ref.galaxy.id, userId: op.userId, role: OperatorRole.MARKET_ADMIN } });
    const cats = await categoryMap(ctx);
    const neutral = await ctx.prisma.collectionPoint.findFirstOrThrow({ where: { marketId: null } });

    const mall = await onboardMerchant(ctx, staff, op.client, { type: MerchantType.MALL_RETAILER, name: 'Mall Fabrics', galaxy: true, fulfilment: [{ method: 'IN_STORE_COLLECTION' }] });
    const home = await onboardMerchant(ctx, staff, null, { type: MerchantType.HOME_VENDOR, name: 'Home Ankara Studio', serviceAreas: [{ areaName: 'Barnawa', deliveryFeeMinor: 50000 }], fulfilment: [{ method: 'MERCHANT_DELIVERY' }, { method: 'COLLECTION_POINT', collectionPointId: neutral.id }] });
    const indep = await onboardMerchant(ctx, staff, null, { type: MerchantType.INDEPENDENT_SHOP, name: 'Kawo Textiles', fulfilment: [{ method: 'IN_STORE_COLLECTION' }] });
    const pending = await onboardMerchant(ctx, staff, null, { type: MerchantType.INDEPENDENT_SHOP, name: 'Unapproved Shop', fulfilment: [{ method: 'IN_STORE_COLLECTION' }], approve: false });

    ids.mall = (await createListing(mall.owner, mall.merchantId, { title: 'Ankara wax print 6 yards', categorySlug: 'fabrics', stockMode: 'TRACKED', price: 2000000, quantity: 5 }, cats)).id;
    ids.home = (await createListing(home.owner, home.merchantId, { title: 'Handmade Ankara tote bag', categorySlug: 'shoes-bags', stockMode: 'MADE_TO_ORDER', price: 800000, leadTimeDays: 3 }, cats)).id;
    ids.indep = (await createListing(indep.owner, indep.merchantId, { title: 'Ankara fabric bundle', categorySlug: 'fabrics', stockMode: 'CONFIRM_ON_ORDER', price: 1500000 }, cats)).id;
    ids.oos = (await createListing(indep.owner, indep.merchantId, { title: 'Ankara headwrap', categorySlug: 'fabrics', stockMode: 'TRACKED', price: 300000, quantity: 0 }, cats)).id;
    ids.pending = (await createListing(pending.owner, pending.merchantId, { title: 'Ankara skirt', categorySlug: 'womens-clothing', stockMode: 'TRACKED', price: 500000, quantity: 3 }, cats)).id;
  });
  afterAll(() => ctx.app.close());

  const search = (qs: string) => new Client(ctx.app).get(`/search?${qs}`);

  it('one search returns mall, home-vendor and independent offerings', async () => {
    const res = await search('q=ankara');
    expect(res.status).toBe(200);
    const found = res.body.items.map((i: { id: string }) => i.id);
    expect(found).toEqual(expect.arrayContaining([ids.mall, ids.home, ids.indep, ids.oos]));
    const types = new Set(res.body.items.map((i: { merchant: { type: string } }) => i.merchant.type));
    expect(types).toEqual(new Set(['MALL_RETAILER', 'HOME_VENDOR', 'INDEPENDENT_SHOP']));
    // Unapproved merchants are never discoverable.
    expect(found).not.toContain(ids.pending);
    // Out-of-stock items rank below purchasable ones.
    expect(found.indexOf(ids.oos)).toBe(found.length - 1);
  });

  it('tolerates typos and prefixes', async () => {
    expect((await search('q=ankra')).body.total).toBeGreaterThanOrEqual(3);
    expect((await search('q=ank')).body.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by market, merchant type, category, price, availability, fulfilment, verification and area', async () => {
    const only = async (qs: string) => (await search(qs)).body.items.map((i: { id: string }) => i.id).sort();
    expect(await only('q=ankara&market=galaxy-mall')).toEqual([ids.mall]);
    expect(await only('q=ankara&merchantType=HOME_VENDOR')).toEqual([ids.home]);
    expect(await only('category=fabrics')).toEqual([ids.mall, ids.indep, ids.oos].sort());
    expect(await only('q=ankara&minPrice=1000000&maxPrice=1800000')).toEqual([ids.indep]);
    expect(await only('q=ankara&availability=in_stock')).toEqual([ids.mall]);
    expect(await only('q=ankara&availability=made_to_order')).toEqual([ids.home]);
    expect(await only('q=ankara&fulfilment=delivery')).toEqual([ids.home]);
    expect((await only('q=ankara&verified=true')).length).toBe(4);
    expect(await only(`q=ankara&area=${ctx.ref.areas['Barnawa']}`)).toEqual(expect.arrayContaining([ids.home]));
  });

  it('sorts and paginates', async () => {
    const asc = (await search('q=ankara&sort=price_asc')).body.items.map((i: { priceFromMinor: number }) => i.priceFromMinor);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const p1 = await search('q=ankara&pageSize=2&page=1');
    const p2 = await search('q=ankara&pageSize=2&page=2');
    expect(p1.body.total).toBe(4);
    expect(p1.body.items).toHaveLength(2);
    expect(p2.body.items).toHaveLength(2);
    expect(p1.body.items[0].id).not.toBe(p2.body.items[0].id);
  });

  it('rejects malformed search input', async () => {
    expect((await search('pageSize=500')).status).toBe(400);
    expect((await search(`q=${encodeURIComponent("'; DROP TABLE listings; --")}`)).status).toBe(200);
  });
});
