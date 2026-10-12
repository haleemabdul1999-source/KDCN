import { MerchantType } from '@prisma/client';
import { Client, idemKey, PNG_1PX, registerCustomer, TestCtx } from './helpers';

function expectStatus(res: { status: number; body: unknown }, status: number, label: string) {
  if (res.status !== status)
    throw new Error(`${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

export interface OnboardOptions {
  type: MerchantType;
  name: string;
  galaxy?: boolean;
  homeAddress?: string;
  fulfilment: {
    method: string;
    collectionPointId?: string;
    feeMinor?: number;
    pickupFromMerchant?: boolean;
  }[];
  serviceAreas?: { areaName: string; deliveryFeeMinor: number }[];
  approve?: boolean;
}

/** Drive the real onboarding API end to end (registration → documents → submission → approval). */
export async function onboardMerchant(
  ctx: TestCtx,
  staff: Client,
  operator: Client | null,
  opts: OnboardOptions,
) {
  const { client: owner, userId, email } = await registerCustomer(ctx.app, `${opts.name} Owner`);
  const area = (name: string) => ctx.ref.areas[name];
  const created = await owner.post('/merchants', {
    displayName: opts.name,
    type: opts.type,
    description: `${opts.name} sells quality goods to customers across Kaduna.`,
    contactEmail: email,
    contactPhone: '08035550000',
    publicAreaId: area(opts.galaxy ? 'Kaduna Central' : 'Barnawa'),
    ...(opts.type === MerchantType.INDEPENDENT_SHOP ? { cacNumber: 'RC123456' } : {}),
  });
  expectStatus(created, 201, 'create merchant');
  const merchantId: string = created.body.id;
  expectStatus(
    await owner.put(`/merchant/${merchantId}/payout`, {
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: opts.name,
    }),
    200,
    'payout',
  );

  if (opts.galaxy) {
    expectStatus(
      await owner.post(`/merchant/${merchantId}/locations`, {
        kind: 'PUBLIC_STORE',
        label: 'Galaxy Mall shop',
        areaId: area('Kaduna Central'),
        publicAddress: 'Shop F3, Galaxy Mall',
        marketId: ctx.ref.galaxy.id,
        unitLabel: 'F3',
      }),
      201,
      'location',
    );
    expectStatus(
      await owner.post(`/merchant/${merchantId}/affiliations`, {
        marketId: ctx.ref.galaxy.id,
        unitLabel: 'F3',
      }),
      201,
      'affiliation',
    );
  } else if (opts.type === MerchantType.HOME_VENDOR) {
    expectStatus(
      await owner.post(`/merchant/${merchantId}/locations`, {
        kind: 'PRIVATE_FULFILMENT',
        label: 'Home',
        areaId: area('Barnawa'),
        privateAddress: opts.homeAddress ?? '7 Secret Crescent, Barnawa',
      }),
      201,
      'private location',
    );
  } else {
    expectStatus(
      await owner.post(`/merchant/${merchantId}/locations`, {
        kind: 'PUBLIC_STORE',
        label: 'Shop',
        areaId: area('Kawo'),
        publicAddress: '5 Kawo Road',
      }),
      201,
      'location',
    );
  }
  if (opts.serviceAreas) {
    expectStatus(
      await owner.put(`/merchant/${merchantId}/service-areas`, {
        areas: opts.serviceAreas.map((s) => ({
          areaId: area(s.areaName),
          deliveryFeeMinor: s.deliveryFeeMinor,
          etaDays: 1,
        })),
      }),
      200,
      'service areas',
    );
  }

  // Galaxy collection desk is only available once the affiliation is approved.
  if (opts.galaxy && operator) {
    const list = await operator.get(`/operator/${ctx.ref.galaxy.id}/merchants`);
    const aff = list.body.find((a: { merchant: { id: string } }) => a.merchant.id === merchantId);
    expectStatus(
      await operator.post(`/operator/${ctx.ref.galaxy.id}/affiliations/${aff.id}/approve`, {
        note: 'Verified tenancy',
      }),
      200,
      'operator approves affiliation',
    );
  }
  expectStatus(
    await owner.put(`/merchant/${merchantId}/fulfilment-options`, {
      options: opts.fulfilment.map((f) => ({ enabled: true, ...f })),
    }),
    200,
    'fulfilment options',
  );

  const readiness = await owner.get(`/merchant/${merchantId}/verification`);
  for (const item of readiness.body.checklist as { key: string; done: boolean }[]) {
    if (item.key.startsWith('doc_') && !item.done) {
      expectStatus(
        await owner.upload(
          `/merchant/${merchantId}/verification/documents`,
          'file',
          PNG_1PX,
          'doc.png',
          { type: item.key.slice(4) },
        ),
        201,
        `upload ${item.key}`,
      );
    }
  }
  expectStatus(await owner.post(`/merchant/${merchantId}/verification/submit`), 200, 'submit');
  if (opts.approve !== false) {
    expectStatus(
      await staff.post(`/admin/merchants/${merchantId}/approve`, { note: 'Documents verified' }),
      200,
      'approve',
    );
  }
  return { owner, merchantId, ownerUserId: userId };
}

export async function createListing(
  owner: Client,
  merchantId: string,
  input: {
    title: string;
    categorySlug: string;
    stockMode: string;
    price: number;
    quantity?: number;
    leadTimeDays?: number;
  },
  categories: Record<string, string>,
) {
  const res = await owner.post(`/merchant/${merchantId}/listings`, {
    title: input.title,
    description: `${input.title} — test listing`,
    categoryId: categories[input.categorySlug],
    stockMode: input.stockMode,
    leadTimeDays: input.leadTimeDays ?? 0,
    variants: [{ name: 'Standard', priceMinor: input.price, quantity: input.quantity }],
    publish: true,
  });
  expectStatus(res, 201, 'create listing');
  return res.body as {
    id: string;
    slug: string;
    variants: { id: string }[];
    product: { moderationStatus: string };
  };
}

export async function categoryMap(ctx: TestCtx) {
  const rows = await ctx.prisma.category.findMany();
  return Object.fromEntries(rows.map((c) => [c.slug, c.id]));
}

export async function placeOrder(
  customer: Client,
  listingVariantId: string,
  merchantId: string,
  fulfilment: Record<string, unknown>,
  quantity = 1,
  key = idemKey(),
) {
  expectStatus(
    await customer.post('/cart/items', { listingVariantId, quantity }),
    201,
    'add to cart',
  );
  const res = await customer
    .post('/checkout/place', { merchantId, acceptTerms: true, ...fulfilment })
    .set('Idempotency-Key', key);
  expectStatus(res, 201, 'place order');
  return res.body.order as { id: string; number: string; status: string; totalMinor: number };
}

/** Pay through the mock provider: initiate → customer completes on hosted page → verify. */
export async function payOrder(
  customer: Client,
  orderId: string,
  outcome: 'success' | 'failed' = 'success',
) {
  const init = await customer.post(`/orders/${orderId}/pay`);
  expectStatus(init, 200, 'initiate payment');
  const done = await customer.post(`/payments/mock/${init.body.reference}/complete`, { outcome });
  expectStatus(done, 200, 'mock complete');
  const verify = await customer.post(`/orders/${orderId}/verify-payment`, {
    reference: init.body.reference,
  });
  expectStatus(verify, 200, 'verify');
  return {
    reference: init.body.reference as string,
    verify: verify.body,
    webhookResult: done.body.webhookResult,
  };
}
