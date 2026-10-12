import { PaymentProvider } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma.service';
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
 * DETERMINISTIC MOCK PROVIDER — development and automated testing only. No money moves.
 *
 * It models an external provider: charges live in `mock_provider_charges`, the hosted payment
 * page is a clearly-labelled test page in the web app, outcomes are chosen explicitly by the
 * tester, webhooks are HMAC-SHA512 signed, and verification goes through `verify()` exactly as
 * with a real provider. Fee model (deterministic): 1.5% capped at ₦2,000.
 *
 * Failure injection: set `MockPaymentProvider.unavailable = true` to simulate an outage.
 */
export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly id = PaymentProvider.MOCK;
  readonly isTestMode = true;
  static unavailable = false;

  constructor(private readonly prisma: PrismaService) {}

  static fee(amountMinor: number): number {
    return Math.min(Math.floor((amountMinor * 150 + 5000) / 10000), 200_000);
  }

  private guard() {
    if (MockPaymentProvider.unavailable) throw new ProviderUnavailableError('Mock provider unavailable (simulated outage)');
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    this.guard();
    await this.prisma.mockProviderCharge.create({
      data: { reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, email: input.email, status: 'pending' },
    });
    return { authorizationUrl: `${env().WEB_BASE_URL}/pay/mock/${encodeURIComponent(input.reference)}` };
  }

  async verify(reference: string): Promise<VerifyResult> {
    this.guard();
    const c = await this.prisma.mockProviderCharge.findUnique({ where: { reference } });
    if (!c) return { status: 'failed', reference, amountMinor: 0, currency: 'NGN', gatewayMessage: 'Transaction not found', raw: null };
    return {
      status: c.status as VerifyResult['status'],
      reference,
      amountMinor: c.amountMinor,
      currency: c.currency,
      providerTransactionId: `mock_${c.reference}`,
      feeMinor: c.status === 'success' ? c.feeMinor : null,
      paidAt: c.status === 'success' ? c.updatedAt : null,
      channel: 'mock',
      gatewayMessage: c.status === 'success' ? 'Approved (TEST MODE)' : c.status,
      raw: { mock: true, ...c },
    };
  }

  /** Simulates the customer completing (or failing) payment on the hosted page. */
  async completeCharge(reference: string, outcome: 'success' | 'failed' | 'abandoned', amountOverrideMinor?: number) {
    const c = await this.prisma.mockProviderCharge.findUnique({ where: { reference } });
    if (!c) return null;
    if (c.status !== 'pending') return c;
    return this.prisma.mockProviderCharge.update({
      where: { reference },
      data: {
        status: outcome,
        feeMinor: outcome === 'success' ? MockPaymentProvider.fee(c.amountMinor) : 0,
        ...(amountOverrideMinor ? { amountMinor: amountOverrideMinor } : {}),
      },
    });
  }

  /** Builds a signed webhook body + headers, as the provider would POST them. */
  static signedWebhook(event: string, data: Record<string, unknown>): { body: Buffer; headers: Record<string, string> } {
    const body = Buffer.from(JSON.stringify({ event, data }));
    const sig = createHmac('sha512', env().MOCK_PAYMENT_WEBHOOK_SECRET).update(body).digest('hex');
    return { body, headers: { 'x-mock-signature': sig, 'content-type': 'application/json' } };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ParsedWebhook | null {
    const sig = headers['x-mock-signature'];
    if (typeof sig !== 'string') return null;
    const expected = createHmac('sha512', env().MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let payload: { event?: string; data?: { reference?: string; id?: string; status?: string } };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    const event = payload.event ?? 'unknown';
    const data = payload.data ?? {};
    if (event.startsWith('charge.')) {
      return { eventKey: `${event}:${data.reference}`, eventType: event, kind: 'charge', reference: data.reference, payload };
    }
    if (event.startsWith('refund.')) {
      return { eventKey: `${event}:${data.id}`, eventType: event, kind: 'refund', providerRefundId: data.id, payload };
    }
    return { eventKey: `${event}:${data.id ?? data.reference}`, eventType: event, kind: 'other', payload };
  }

  async refund(input: { reference: string; amountMinor: number }): Promise<RefundResult> {
    this.guard();
    const c = await this.prisma.mockProviderCharge.findUnique({ where: { reference: input.reference } });
    if (!c || c.status !== 'success') return { providerRefundId: `mockrf_${input.reference}_${Date.now()}`, status: 'failed', raw: { reason: 'charge not successful' } };
    if (c.refundedMinor + input.amountMinor > c.amountMinor) {
      return { providerRefundId: `mockrf_${input.reference}_${Date.now()}`, status: 'failed', raw: { reason: 'refund exceeds charge' } };
    }
    await this.prisma.mockProviderCharge.update({ where: { reference: input.reference }, data: { refundedMinor: { increment: input.amountMinor } } });
    return { providerRefundId: `mockrf_${input.reference}_${c.refundedMinor + input.amountMinor}`, status: 'processed', raw: { mock: true } };
  }

  async fetchRefund(providerRefundId: string): Promise<RefundResult> {
    this.guard();
    return { providerRefundId, status: 'processed', raw: { mock: true } };
  }
}
