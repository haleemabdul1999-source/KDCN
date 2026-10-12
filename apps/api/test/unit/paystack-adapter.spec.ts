/**
 * Contract tests for the Paystack adapter against a stubbed fetch. These verify the requests
 * we send and how we interpret responses; they do NOT prove compatibility with the live API —
 * see docs/PAYMENTS.md for the sandbox activation checklist.
 */
import { createHmac } from 'node:crypto';
import { PaystackProvider } from '../../src/modules/payments/providers/paystack.provider';
import { ProviderUnavailableError } from '../../src/modules/payments/providers/payment-provider';

const KEY = 'sk_test_abc123';

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('PaystackProvider', () => {
  it('initialises with amount in kobo, our reference and bearer auth', async () => {
    const { fn, calls } = stubFetch(200, {
      status: true,
      data: {
        authorization_url: 'https://checkout.paystack.com/x',
        access_code: 'x',
        reference: 'REF1',
      },
    });
    const p = new PaystackProvider(KEY, 'https://api.paystack.co', fn);
    const res = await p.initialize({
      reference: 'REF1',
      amountMinor: 1850000,
      currency: 'NGN',
      email: 'a@b.ng',
      callbackUrl: 'https://kdcn/cb',
      metadata: { orderId: 'o1' },
      split: { subaccountCode: 'ACCT_1', platformShareMinor: 92500 },
    });
    expect(res.authorizationUrl).toBe('https://checkout.paystack.com/x');
    expect(calls[0].url).toBe('https://api.paystack.co/transaction/initialize');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      amount: 1850000,
      reference: 'REF1',
      currency: 'NGN',
      subaccount: 'ACCT_1',
      transaction_charge: 92500,
      bearer: 'account',
    });
    expect(p.isTestMode).toBe(true);
  });

  it('maps verification responses', async () => {
    const ok = stubFetch(200, {
      status: true,
      data: {
        id: 99,
        status: 'success',
        reference: 'REF1',
        amount: 1850000,
        currency: 'NGN',
        paid_at: '2026-01-01T10:00:00Z',
        fees: 27750,
        channel: 'card',
        gateway_response: 'Approved',
      },
    });
    const r = await new PaystackProvider(KEY, 'https://api.paystack.co', ok.fn).verify('REF1');
    expect(r).toMatchObject({
      status: 'success',
      amountMinor: 1850000,
      feeMinor: 27750,
      providerTransactionId: '99',
    });
    expect(ok.calls[0].url).toBe('https://api.paystack.co/transaction/verify/REF1');
    for (const [s, expected] of [
      ['abandoned', 'abandoned'],
      ['failed', 'failed'],
      ['reversed', 'failed'],
      ['ongoing', 'pending'],
    ]) {
      const f = stubFetch(200, {
        status: true,
        data: { id: 1, status: s, reference: 'R', amount: 1, currency: 'NGN' },
      });
      expect(
        (await new PaystackProvider(KEY, 'https://api.paystack.co', f.fn).verify('R')).status,
      ).toBe(expected);
    }
  });

  it('treats 5xx and network errors as provider unavailability', async () => {
    const down = stubFetch(503, { status: false });
    await expect(
      new PaystackProvider(KEY, 'https://api.paystack.co', down.fn).verify('R'),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    const broken = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new PaystackProvider(KEY, 'https://api.paystack.co', broken).initialize({
        reference: 'R',
        amountMinor: 100,
        currency: 'NGN',
        email: 'a@b.ng',
        callbackUrl: 'x',
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('verifies webhook signatures (HMAC-SHA512 of the raw body)', () => {
    const p = new PaystackProvider(KEY, 'https://api.paystack.co');
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { id: 5, reference: 'REF1', status: 'success' },
      }),
    );
    const sig = createHmac('sha512', KEY).update(body).digest('hex');
    const parsed = p.parseWebhook(body, { 'x-paystack-signature': sig });
    expect(parsed).toMatchObject({
      kind: 'charge',
      reference: 'REF1',
      eventType: 'charge.success',
    });
    expect(
      p.parseWebhook(body, {
        'x-paystack-signature': sig.replace(/.$/, sig.endsWith('0') ? '1' : '0'),
      }),
    ).toBeNull();
    expect(
      p.parseWebhook(Buffer.from(body.toString().replace('REF1', 'REF2')), {
        'x-paystack-signature': sig,
      }),
    ).toBeNull();
    expect(p.parseWebhook(body, {})).toBeNull();
    // Same body redelivered → same event key (idempotent).
    expect(p.parseWebhook(body, { 'x-paystack-signature': sig })!.eventKey).toBe(parsed!.eventKey);
  });

  it('creates refunds against our reference', async () => {
    const { fn, calls } = stubFetch(200, { status: true, data: { id: 777, status: 'pending' } });
    const r = await new PaystackProvider(KEY, 'https://api.paystack.co', fn).refund({
      reference: 'REF1',
      amountMinor: 5000,
      reason: 'Customer cancelled',
    });
    expect(r).toMatchObject({ providerRefundId: '777', status: 'pending' });
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      transaction: 'REF1',
      amount: 5000,
    });
  });
});
