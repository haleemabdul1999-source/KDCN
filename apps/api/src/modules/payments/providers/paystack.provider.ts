import { Logger } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sha256 } from '../../../common/crypto';
import {
  InitializeInput,
  InitializeResult,
  ParsedWebhook,
  PaymentProviderAdapter,
  ProviderUnavailableError,
  RefundResult,
  VerifyResult,
} from './payment-provider';

/**
 * Paystack adapter (https://paystack.com/docs/api/).
 *
 * STATUS: implemented from Paystack's published API conventions but NOT yet exercised against
 * the Paystack sandbox from this environment (outbound access to paystack.co was unavailable
 * during development). Before enabling PAYMENT_PROVIDER=paystack, run the checklist in
 * docs/PAYMENTS.md ("Paystack activation checklist") with test keys.
 *
 * Endpoints used:
 *   POST /transaction/initialize   GET /transaction/verify/:reference
 *   POST /refund                   GET /refund/:id
 * Webhooks: `x-paystack-signature` = HMAC-SHA512(secret key, raw request body), hex.
 */
export class PaystackProvider implements PaymentProviderAdapter {
  readonly id = PaymentProvider.PAYSTACK;
  readonly isTestMode: boolean;
  private readonly logger = new Logger('PaystackProvider');

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.isTestMode = secretKey.startsWith('sk_test_');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ProviderUnavailableError('Paystack is unreachable', e);
    }
    const json = (await res.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: unknown;
    } | null;
    if (res.status >= 500 || res.status === 429)
      throw new ProviderUnavailableError(`Paystack error ${res.status}`);
    if (!json || json.status !== true) {
      const err = new Error(`Paystack request failed: ${json?.message ?? res.status}`);
      (err as Error & { httpStatus?: number }).httpStatus = res.status;
      throw err;
    }
    return json.data as T;
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const data = await this.call<{ authorization_url: string; reference: string }>(
      'POST',
      '/transaction/initialize',
      {
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
        ...(input.split
          ? {
              subaccount: input.split.subaccountCode,
              transaction_charge: input.split.platformShareMinor,
              bearer: 'account',
            }
          : {}),
      },
    );
    return { authorizationUrl: data.authorization_url, providerReference: data.reference };
  }

  async verify(reference: string): Promise<VerifyResult> {
    let data: {
      id: number;
      status: string;
      reference: string;
      amount: number;
      currency: string;
      paid_at: string | null;
      fees: number | null;
      channel: string | null;
      gateway_response: string | null;
    };
    try {
      data = await this.call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    } catch (e) {
      if (
        (e as { httpStatus?: number }).httpStatus === 400 ||
        (e as { httpStatus?: number }).httpStatus === 404
      ) {
        return {
          status: 'failed',
          reference,
          amountMinor: 0,
          currency: 'NGN',
          gatewayMessage: 'Transaction not found',
          raw: null,
        };
      }
      throw e;
    }
    const status: VerifyResult['status'] =
      data.status === 'success'
        ? 'success'
        : data.status === 'failed' || data.status === 'reversed'
          ? 'failed'
          : data.status === 'abandoned'
            ? 'abandoned'
            : 'pending';
    return {
      status,
      reference: data.reference,
      amountMinor: data.amount,
      currency: data.currency,
      providerTransactionId: String(data.id),
      feeMinor: data.fees ?? null,
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      channel: data.channel,
      gatewayMessage: data.gateway_response,
      raw: data,
    };
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ParsedWebhook | null {
    const sig = headers['x-paystack-signature'];
    if (typeof sig !== 'string' || !/^[0-9a-f]+$/i.test(sig)) return null;
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let payload: { event?: string; data?: Record<string, unknown> };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    const event = payload.event ?? 'unknown';
    const data = payload.data ?? {};
    const key = `${event}:${String(data.id ?? '')}:${sha256(rawBody).slice(0, 16)}`;
    if (event.startsWith('charge.')) {
      return {
        eventKey: key,
        eventType: event,
        kind: 'charge',
        reference: data.reference as string | undefined,
        payload,
      };
    }
    if (event.startsWith('refund.')) {
      return {
        eventKey: key,
        eventType: event,
        kind: 'refund',
        providerRefundId: data.id != null ? String(data.id) : undefined,
        payload,
      };
    }
    this.logger.log({ msg: 'paystack.webhook_ignored', event });
    return { eventKey: key, eventType: event, kind: 'other', payload };
  }

  private mapRefund(data: { id: number | string; status: string }): RefundResult {
    const s = data.status;
    return {
      providerRefundId: String(data.id),
      status: s === 'processed' ? 'processed' : s === 'failed' ? 'failed' : 'pending',
      raw: data,
    };
  }

  async refund(input: {
    reference: string;
    amountMinor: number;
    reason: string;
  }): Promise<RefundResult> {
    const data = await this.call<{ id: number; status: string }>('POST', '/refund', {
      transaction: input.reference,
      amount: input.amountMinor,
      merchant_note: input.reason.slice(0, 200),
    });
    return this.mapRefund(data);
  }

  async fetchRefund(providerRefundId: string): Promise<RefundResult> {
    const data = await this.call<{ id: number; status: string }>(
      'GET',
      `/refund/${encodeURIComponent(providerRefundId)}`,
    );
    return this.mapRefund(data);
  }
}
