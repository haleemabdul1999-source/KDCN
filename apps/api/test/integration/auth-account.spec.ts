/** Authentication lifecycle: lockout, password reset, sessions, account deletion, retention. */
import { MerchantType } from '@prisma/client';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { Client, registerCustomer, setupApp, staffClient, TestCtx } from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder } from '../flows';

describe('auth & account lifecycle', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await setupApp();
  });
  afterAll(() => ctx.app.close());

  it('locks an account after repeated failed sign-ins and does not reveal whether emails exist', async () => {
    const { email } = await registerCustomer(ctx.app);
    const c = new Client(ctx.app);
    for (let i = 0; i < 5; i++)
      expect((await c.post('/auth/login', { email, password: 'wrong-password-1' })).status).toBe(
        401,
      );
    const locked = await c.post('/auth/login', { email, password: 'Password1234' });
    expect(locked.status).toBe(401);
    expect(locked.body.message).toMatch(/temporarily locked/);
    const unknown = await c.post('/auth/login', { email: 'nobody@test.kdcn.ng', password: 'x' });
    expect(unknown.body.message).toBe('Invalid email or password');
  });

  it('resets a password with a single-use token and revokes existing sessions', async () => {
    const { client, email, userId } = await registerCustomer(ctx.app);
    const anon = new Client(ctx.app);
    expect(
      (await anon.post('/auth/password-reset/request', { email: 'unknown@test.kdcn.ng' })).status,
    ).toBe(204);
    expect((await anon.post('/auth/password-reset/request', { email })).status).toBe(204);
    const note = await ctx.prisma.notification.findFirstOrThrow({
      where: { userId, template: 'auth.password_reset', channel: 'EMAIL' },
    });
    const token = note.body.match(/reset-password\/([\w-]+)/)![1];
    expect(
      (await anon.post('/auth/password-reset/confirm', { token, newPassword: 'short' })).status,
    ).toBe(400);
    expect(
      (await anon.post('/auth/password-reset/confirm', { token, newPassword: 'BrandNewPass99' }))
        .status,
    ).toBe(204);
    expect(
      (await anon.post('/auth/password-reset/confirm', { token, newPassword: 'AnotherPass99' }))
        .status,
    ).toBe(400);
    // Old session revoked; new password works; old does not.
    expect((await client.get('/auth/me')).body.user).toBeNull();
    expect(
      (await new Client(ctx.app).post('/auth/login', { email, password: 'Password1234' })).status,
    ).toBe(401);
    expect(
      (await new Client(ctx.app).post('/auth/login', { email, password: 'BrandNewPass99' })).status,
    ).toBe(200);
  });

  it('deletes an account (anonymising personal data) only when no orders are in progress', async () => {
    const staff = await staffClient(ctx);
    const shop = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.INDEPENDENT_SHOP,
      name: 'Delete Test Shop',
      serviceAreas: [{ areaName: 'Kawo', deliveryFeeMinor: 0 }],
      fulfilment: [{ method: 'MERCHANT_DELIVERY' }],
    });
    const cats = await categoryMap(ctx);
    const l = await createListing(
      shop.owner,
      shop.merchantId,
      { title: 'Mug', categorySlug: 'kitchen', stockMode: 'CONFIRM_ON_ORDER', price: 100000 },
      cats,
    );
    const { client, email, userId } = await registerCustomer(ctx.app, 'Private Person');
    const order = await placeOrder(client, l.variants[0].id, shop.merchantId, {
      fulfilmentMethod: 'MERCHANT_DELIVERY',
      deliveryAreaId: ctx.ref.areas['Kawo'],
      deliveryAddress: '1 Secret Street',
      recipientPhone: '08039990000',
    });

    // The customer is told the order was received, with a link to track it.
    const placed = await ctx.prisma.notification.findFirstOrThrow({
      where: { userId, template: 'order.placed', channel: 'EMAIL' },
    });
    expect(placed.body).toContain(`/orders/${order.id}`);

    expect((await client.post('/auth/account/delete', { password: 'wrong' })).status).toBe(401);
    expect((await client.post('/auth/account/delete', { password: 'Password1234' })).status).toBe(
      409,
    ); // order in progress
    // Store owners must close their store first.
    expect(
      (await shop.owner.post('/auth/account/delete', { password: 'Password1234' })).status,
    ).toBe(409);

    await client.post(`/orders/${order.id}/cancel`);
    expect((await client.post('/auth/account/delete', { password: 'Password1234' })).status).toBe(
      204,
    );
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u).toMatchObject({ status: 'DELETED', name: 'Deleted user', phone: null });
    expect(u.email).not.toBe(email);
    const f = await ctx.prisma.fulfilment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(f.deliveryAddressEnc).toBeNull();
    expect(f.recipientPhone).toBeNull();
    // The order record (financial history) is retained.
    expect(await ctx.prisma.order.count({ where: { id: order.id } })).toBe(1);
    expect(
      (await new Client(ctx.app).post('/auth/login', { email, password: 'Password1234' })).status,
    ).toBe(401);
    expect(
      await ctx.prisma.auditEvent.count({
        where: { action: 'auth.account_deleted', entityId: userId },
      }),
    ).toBe(1);
  });

  it('retention job removes expired sessions and stale tokens but no financial records', async () => {
    const before = await ctx.prisma.order.count();
    await ctx.prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 40 * 86400_000) },
    });
    const removed = await ctx.app.get(JobsService).retentionCleanup();
    expect(removed).toBeGreaterThan(0);
    expect(await ctx.prisma.session.count()).toBe(0);
    expect(await ctx.prisma.order.count()).toBe(before);
  });
});
