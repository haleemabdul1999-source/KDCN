/**
 * Scenario B — Home-based vendor: registers, passes verification, creates a storefront,
 * publishes merchandise without exposing a residential address, receives an order and
 * coordinates delivery.
 */
import { MerchantType } from '@prisma/client';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client, jpegWithExif, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder, payOrder } from '../flows';

const SECRET_ADDRESS = '42 Hidden Lane, Barnawa';

describe('Scenario B — Home-based vendor', () => {
  let ctx: TestCtx;
  let staff: Client;

  beforeAll(async () => {
    ctx = await setupApp();
    staff = await staffClient(ctx);
  });
  afterAll(() => ctx.app.close());

  it('onboards, sells and delivers without ever exposing the residential address publicly', async () => {
    const neutral = await ctx.prisma.collectionPoint.findFirstOrThrow({ where: { marketId: null } });
    const { owner, merchantId } = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.HOME_VENDOR,
      name: 'Hauwa Treats',
      homeAddress: SECRET_ADDRESS,
      serviceAreas: [{ areaName: 'Barnawa', deliveryFeeMinor: 80000 }, { areaName: 'Narayi', deliveryFeeMinor: 100000 }],
      fulfilment: [{ method: 'MERCHANT_DELIVERY' }, { method: 'COLLECTION_POINT', collectionPointId: neutral.id, feeMinor: 50000 }],
    });

    // Home vendors cannot offer collection from their premises.
    const homePickup = await owner.put(`/merchant/${merchantId}/fulfilment-options`, { options: [{ method: 'IN_STORE_COLLECTION', enabled: true }] });
    expect(homePickup.status).toBe(400);

    const cats = await categoryMap(ctx);
    // Food is an enhanced-review category for home vendors: held for moderation.
    const cake = await createListing(owner, merchantId, { title: 'Red velvet cake', categorySlug: 'cakes-pastries', stockMode: 'MADE_TO_ORDER', price: 3000000, leadTimeDays: 2 }, cats);
    expect(cake.product.moderationStatus).toBe('PENDING_REVIEW');
    const anon = new Client(ctx.app);
    expect((await anon.get(`/listings/${cake.slug}`)).status).toBe(404);
    // Prohibited category is refused outright.
    const med = await owner.post(`/merchant/${merchantId}/listings`, { title: 'Paracetamol', categoryId: cats['medicines'], variants: [{ priceMinor: 50000 }], publish: true });
    expect(med.status).toBe(400);

    // Staff moderation approves the product.
    const productId = (await ctx.prisma.listing.findUniqueOrThrow({ where: { id: cake.id } })).productId;
    expect((await staff.post(`/admin/moderation/products/${productId}`, { decision: 'APPROVED', note: 'Food handling permit seen' })).status).toBe(200);

    // Product photo with EXIF GPS is stripped before storage.
    const img = await owner.upload(`/merchant/${merchantId}/listings/${cake.id}/images`, 'file', jpegWithExif(), 'cake.jpg');
    expect(img.status).toBe(201);
    const dir = join(process.env.STORAGE_LOCAL_DIR!, 'public', 'products');
    const newest = readdirSync(dir).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    expect(readFileSync(newest).toString('latin1')).not.toContain('GPSLatitude');

    // Public surfaces never contain the residential address.
    const storefront = await anon.get(`/storefronts/${(await ctx.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).slug}`);
    const product = await anon.get(`/listings/${cake.slug}`);
    const search = await anon.get('/search?q=velvet');
    const home = await anon.get('/home');
    for (const res of [storefront, product, search, home]) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Hidden Lane');
      expect(text).not.toContain('privateAddress');
      expect(text).not.toContain('payout');
    }
    expect(storefront.body.merchant.publicAreaLabel).toBe('Barnawa, Kaduna');
    expect(product.body.availability ?? product.body.variants[0].availability.code).toBeDefined();
    expect(product.body.variants[0].availability.code).toBe('MADE_TO_ORDER');
    // The address is also stored encrypted at rest.
    const loc = await ctx.prisma.merchantLocation.findFirstOrThrow({ where: { merchantId } });
    expect(loc.privateAddressEnc).toMatch(/^enc:v1:/);
    expect(loc.privateAddressEnc).not.toContain('Hidden');

    // Order with merchant delivery to Narayi.
    const { client: customer } = await registerCustomer(ctx.app);
    const order = await placeOrder(customer, cake.variants[0].id, merchantId, {
      fulfilmentMethod: 'MERCHANT_DELIVERY',
      deliveryAreaId: ctx.ref.areas['Narayi'],
      deliveryAddress: '3 Customer Street, Narayi',
      recipientPhone: '08039998888',
    });
    expect(order.status).toBe('PENDING_MERCHANT_CONFIRMATION');
    expect(order.totalMinor).toBe(3000000 + 100000 + 10000);
    // Delivery to an area the vendor does not serve is refused.
    const bad = await customer.post('/checkout/quote', { merchantId, fulfilmentMethod: 'MERCHANT_DELIVERY', deliveryAreaId: ctx.ref.areas['Rigasa'] });
    expect(bad.status).toBe(400);

    expect((await owner.post(`/merchant/${merchantId}/orders/${order.id}/confirm`)).status).toBe(200);
    expect((await payOrder(customer, order.id)).verify.order.status).toBe('PAID');

    // Now the merchant sees the customer's delivery address and phone.
    const mv = await owner.get(`/merchant/${merchantId}/orders/${order.id}`);
    expect(mv.body.fulfilment.deliveryAddress).toBe('3 Customer Street, Narayi');
    expect(mv.body.customer.phone).toBe('08039998888');

    for (const action of ['accept', 'preparing']) expect((await owner.post(`/merchant/${merchantId}/orders/${order.id}/${action}`)).status).toBe(200);
    const dispatched = await owner.post(`/merchant/${merchantId}/orders/${order.id}/dispatch`, { partnerName: 'Own rider', riderName: 'Musa', riderPhone: '08031112222' });
    expect(dispatched.body.status).toBe('DISPATCHED');
    const cv = await customer.get(`/orders/${order.id}`);
    expect(cv.body.fulfilment.rider).toMatchObject({ name: 'Musa', phone: '08031112222' });
    expect(cv.body.fulfilment.liveTracking).toBe(false);

    expect((await owner.post(`/merchant/${merchantId}/orders/${order.id}/delivered`, { note: 'Handed to customer' })).body.status).toBe('DELIVERED');
    const done = await customer.post(`/orders/${order.id}/confirm-receipt`);
    expect(done.body.status).toBe('COMPLETED');

    // Verified-purchase review; merchant can respond once but not edit.
    const review = await customer.post(`/orders/${order.id}/review`, { rating: 5, body: 'Delicious and on time' });
    expect(review.status).toBe(201);
    const reviewId = (await ctx.prisma.review.findFirstOrThrow({ where: { orderId: order.id } })).id;
    expect((await owner.post(`/merchant/${merchantId}/reviews/${reviewId}/respond`, { response: 'Thank you!' })).status).toBe(204);
    expect((await owner.post(`/merchant/${merchantId}/reviews/${reviewId}/respond`, { response: 'Edited' })).status).toBe(409);
    expect((await customer.post(`/orders/${order.id}/review`, { rating: 1 })).status).toBe(409);
  });
});
