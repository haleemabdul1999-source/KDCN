/**
 * Scenario F — Authorised KDCN staff can review merchants, handle disputes and manage
 * transactions, with sensitive actions recorded in audit logs.
 */
import { MerchantType } from '@prisma/client';
import { hashPassword } from '../../src/common/crypto';
import {
  Client,
  PNG_1PX,
  registerCustomer,
  setupApp,
  staffClient,
  TestCtx,
  uniqueEmail,
} from '../helpers';
import { categoryMap, createListing, onboardMerchant, placeOrder, payOrder } from '../flows';

describe('Scenario F — administrative governance', () => {
  let ctx: TestCtx;
  let staff: Client;

  beforeAll(async () => {
    ctx = await setupApp();
    staff = await staffClient(ctx);
  });
  afterAll(() => ctx.app.close());

  const audits = (action: string, entityId?: string) =>
    ctx.prisma.auditEvent.count({ where: { action, ...(entityId ? { entityId } : {}) } });

  it('staff without a verified MFA session are blocked from admin APIs', async () => {
    const email = uniqueEmail('nomfa');
    await ctx.prisma.user.create({
      data: {
        email,
        name: 'New staff',
        passwordHash: await hashPassword('StaffPassword123'),
        staffRoles: ['OPERATIONS'],
      },
    });
    const c = new Client(ctx.app);
    const login = await c.post('/auth/login', { email, password: 'StaffPassword123' });
    expect(login.body).toMatchObject({ mfaRequired: false, mfaEnrolmentRequired: true });
    const blocked = await c.get('/admin/merchants');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_REQUIRED');
    const setup = await c.post('/auth/mfa/setup');
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    expect((await c.post('/auth/mfa/verify', { code: '000000' })).status).toBe(401);
  });

  it('reviews a merchant: request information → resubmission → approval → suspension, all audited', async () => {
    const m = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.HOME_VENDOR,
      name: 'Review Me',
      serviceAreas: [{ areaName: 'Barnawa', deliveryFeeMinor: 50000 }],
      fulfilment: [{ method: 'MERCHANT_DELIVERY' }],
      approve: false,
    });
    const queue = await staff.get('/admin/merchants?status=PENDING_REVIEW');
    expect(queue.body.items.map((x: { id: string }) => x.id)).toContain(m.merchantId);

    const detail = await staff.get(`/admin/merchants/${m.merchantId}`);
    expect(detail.body.locations[0].privateAddress).toContain('Secret Crescent'); // staff may see it…
    expect(await audits('admin.merchant_viewed', m.merchantId)).toBe(1); // …and that access is audited
    const doc = detail.body.verifications[0].documents[0];
    const file = await staff.get(`/admin/verification-documents/${doc.id}`);
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body).subarray(0, 4).toString('hex')).toBe('89504e47'); // decrypted PNG
    expect(await audits('admin.verification_document_viewed', doc.id)).toBe(1);
    // Merchant owners cannot fetch documents through the admin API.
    expect((await m.owner.get(`/admin/verification-documents/${doc.id}`)).status).toBe(403);

    // Request enhanced verification.
    expect(
      (
        await staff.post(`/admin/merchants/${m.merchantId}/request-info`, {
          note: 'Please add proof of address',
          riskTier: 'ENHANCED',
        })
      ).status,
    ).toBe(200);
    const readiness = await m.owner.get(`/merchant/${m.merchantId}/verification`);
    expect(readiness.body.pathway).toBe('ENHANCED');
    expect(readiness.body.canSubmit).toBe(false);
    expect((await m.owner.post(`/merchant/${m.merchantId}/verification/submit`)).status).toBe(400);
    await m.owner.upload(
      `/merchant/${m.merchantId}/verification/documents`,
      'file',
      PNG_1PX,
      'bill.png',
      { type: 'PROOF_OF_ADDRESS' },
    );
    expect((await m.owner.post(`/merchant/${m.merchantId}/verification/submit`)).status).toBe(200);
    expect(
      (await staff.post(`/admin/merchants/${m.merchantId}/approve`, { note: 'OK' })).status,
    ).toBe(200);
    const v = await ctx.prisma.merchantVerification.findFirstOrThrow({
      where: { merchantId: m.merchantId, status: 'APPROVED' },
    });
    expect(v.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * 86400_000);

    // Suspension removes the merchant's listings from discovery.
    const cats = await categoryMap(ctx);
    const listing = await createListing(
      m.owner,
      m.merchantId,
      { title: 'Woven basket', categorySlug: 'decor', stockMode: 'MADE_TO_ORDER', price: 500000 },
      cats,
    );
    const anon = new Client(ctx.app);
    expect((await anon.get('/search?q=woven')).body.total).toBe(1);
    expect(
      (
        await staff.post(`/admin/merchants/${m.merchantId}/suspend`, {
          note: 'Counterfeit complaints under investigation',
        })
      ).status,
    ).toBe(200);
    expect((await anon.get('/search?q=woven')).body.total).toBe(0);
    expect((await anon.get(`/listings/${listing.slug}`)).status).toBe(404);
    expect(
      (await staff.post(`/admin/merchants/${m.merchantId}/reinstate`, { note: 'Cleared' })).status,
    ).toBe(200);

    for (const action of [
      'merchant.info_requested',
      'merchant.approved',
      'merchant.suspended',
      'merchant.reinstated',
      'verification.submitted',
    ]) {
      expect(await audits(action, m.merchantId)).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles a dispute end-to-end with a partial refund', async () => {
    const m = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.INDEPENDENT_SHOP,
      name: 'Dispute Shop',
      fulfilment: [{ method: 'IN_STORE_COLLECTION' }],
    });
    const cats = await categoryMap(ctx);
    const l = await createListing(
      m.owner,
      m.merchantId,
      {
        title: 'Blender',
        categorySlug: 'appliances',
        stockMode: 'TRACKED',
        price: 4000000,
        quantity: 5,
      },
      cats,
    );
    const { client: customer } = await registerCustomer(ctx.app);
    const order = await placeOrder(customer, l.variants[0].id, m.merchantId, {
      fulfilmentMethod: 'IN_STORE_COLLECTION',
    });
    await payOrder(customer, order.id);
    for (const a of ['accept', 'preparing', 'ready'])
      await m.owner.post(`/merchant/${m.merchantId}/orders/${order.id}/${a}`);
    const code = (await customer.get(`/orders/${order.id}`)).body.fulfilment.collectionCode;
    await m.owner.post(`/merchant/${m.merchantId}/orders/${order.id}/collected`, { code });

    const opened = await customer.post(`/orders/${order.id}/disputes`, {
      reason: 'damaged',
      description: 'The jar was cracked when I opened the box at home.',
    });
    expect(opened.status).toBe(201);
    expect(opened.body.status).toBe('DISPUTED');
    expect(
      (await ctx.prisma.settlementAllocation.findUniqueOrThrow({ where: { orderId: order.id } }))
        .status,
    ).toBe('ON_HOLD');
    // A second open dispute is refused.
    expect(
      (
        await customer.post(`/orders/${order.id}/disputes`, {
          reason: 'other',
          description: 'Opening a second one now',
        })
      ).status,
    ).toBe(409);

    const disputeId = opened.body.dispute.id;
    expect(
      (
        await m.owner.post(`/merchant/${m.merchantId}/disputes/${disputeId}/messages`, {
          body: 'We tested it before handover; happy to replace the jar.',
        })
      ).status,
    ).toBe(201);
    expect((await staff.post(`/admin/disputes/${disputeId}/assign`)).status).toBe(204);
    const resolved = await staff.post(`/admin/disputes/${disputeId}/resolve`, {
      outcome: 'REFUND_PARTIAL',
      amountMinor: 1000000,
      note: 'Partial refund for the damaged jar',
    });
    expect(resolved.status).toBe(204);

    const after = await customer.get(`/orders/${order.id}`);
    expect(after.body.status).toBe('COMPLETED');
    expect(after.body.refundedMinor).toBe(1000000);
    const s = await ctx.prisma.settlementAllocation.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(s).toMatchObject({
      status: 'ELIGIBLE',
      refundedMinor: 1000000,
      merchantNetMinor: 4000000 - 200000 - 1000000,
    });
    // Re-resolving is refused; no second refund.
    expect(
      (
        await staff.post(`/admin/disputes/${disputeId}/resolve`, {
          outcome: 'REFUND_FULL',
          note: 'again please',
        })
      ).status,
    ).toBe(409);
    expect(await ctx.prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
    expect(await audits('dispute.resolved', disputeId)).toBe(1);
  });

  it('staff refunds need finance approval, and the audit trail is append-only', async () => {
    const m = await onboardMerchant(ctx, staff, null, {
      type: MerchantType.INDEPENDENT_SHOP,
      name: 'Goodwill Shop',
      fulfilment: [{ method: 'IN_STORE_COLLECTION' }],
    });
    const cats = await categoryMap(ctx);
    const l = await createListing(
      m.owner,
      m.merchantId,
      { title: 'Pan', categorySlug: 'kitchen', stockMode: 'TRACKED', price: 300000, quantity: 5 },
      cats,
    );
    const { client: customer } = await registerCustomer(ctx.app);
    const order = await placeOrder(customer, l.variants[0].id, m.merchantId, {
      fulfilmentMethod: 'IN_STORE_COLLECTION',
    });
    await payOrder(customer, order.id);

    const support = await staffClient(ctx, ['SUPPORT']);
    const req = await support.post(`/admin/orders/${order.id}/refunds`, {
      amountMinor: 50000,
      reason: 'Goodwill for delay',
      idempotencyKey: 'goodwill-1',
    });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('REQUESTED');
    // Idempotent: same key returns the same refund.
    const again = await support.post(`/admin/orders/${order.id}/refunds`, {
      amountMinor: 50000,
      reason: 'Goodwill for delay',
      idempotencyKey: 'goodwill-1',
    });
    expect(again.body.id).toBe(req.body.id);
    // Refund exceeding the paid amount is refused.
    expect(
      (
        await support.post(`/admin/orders/${order.id}/refunds`, {
          amountMinor: 9_999_999,
          reason: 'Too much',
          idempotencyKey: 'goodwill-2',
        })
      ).status,
    ).toBe(409);
    // Support cannot approve; finance can.
    expect((await support.post(`/admin/refunds/${req.body.id}/approve`)).status).toBe(403);
    const finance = await staffClient(ctx, ['FINANCE']);
    const approved = await finance.post(`/admin/refunds/${req.body.id}/approve`);
    expect(approved.body.status).toBe('SUCCEEDED');
    expect(await audits('refund.approved', req.body.id)).toBe(1);

    await expect(
      ctx.prisma.$executeRaw`UPDATE audit_events SET action = 'tampered'`,
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`DELETE FROM audit_events`).rejects.toThrow(/append-only/);
    const log = await staff.get('/admin/audit?action=refund');
    expect(log.body.total).toBeGreaterThanOrEqual(2);
  });

  it('commission changes are audited and applied to new orders only', async () => {
    const res = await staff.put('/admin/commission-rules', {
      scope: 'MERCHANT_TYPE',
      scopeValue: 'INDEPENDENT_SHOP',
      rateBps: 300,
      serviceFeeMinor: 5000,
    });
    expect(res.status).toBe(200);
    expect(await audits('commission.rule_changed', res.body.id)).toBe(1);
    const prior = await ctx.prisma.order.findFirstOrThrow({
      where: { merchant: { type: 'INDEPENDENT_SHOP' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(prior.commissionBps).toBe(500); // snapshot unaffected
  });
});
