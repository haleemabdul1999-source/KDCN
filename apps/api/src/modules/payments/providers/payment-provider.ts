import { PaymentProvider } from '@prisma/client';

/**
 * Provider abstraction. The order system depends only on this interface, so a provider can be
 * replaced (Paystack ↔ Flutterwave ↔ other) without touching order management.
 *
 * Rules every implementation must follow:
 *  - `verify` must call the provider's server-side verification API; payment success is NEVER
 *    inferred from a browser redirect or from an unverified webhook body.
 *  - Amounts are integer minor units (kobo).
 */
export interface InitializeInput {
  reference: string;
  amountMinor: number;
  currency: 'NGN';
  email: string;
  callbackUrl: string;
  metadata: Record<string, string>;
  /** Provider split: merchant subaccount and the platform's flat share in minor units. */
  split?: { subaccountCode: string; platformShareMinor: number };
}

export interface InitializeResult {
  authorizationUrl: string;
  providerReference?: string;
}

export type VerifiedStatus = 'success' | 'failed' | 'abandoned' | 'pending';

export interface VerifyResult {
  status: VerifiedStatus;
  reference: string;
  amountMinor: number;
  currency: string;
  providerTransactionId?: string;
  feeMinor?: number | null;
  paidAt?: Date | null;
  channel?: string | null;
  gatewayMessage?: string | null;
  raw: unknown;
}

export interface ParsedWebhook {
  /** Stable identifier for de-duplication of redeliveries. */
  eventKey: string;
  eventType: string;
  kind: 'charge' | 'refund' | 'other';
  /** Our payment reference (charge events) — must still be verified server-side. */
  reference?: string;
  /** Provider refund id (refund events). */
  providerRefundId?: string;
  payload: unknown;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'pending' | 'processed' | 'failed';
  raw: unknown;
}

export interface PaymentProviderAdapter {
  readonly id: PaymentProvider;
  readonly isTestMode: boolean;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  verify(reference: string): Promise<VerifyResult>;
  /** Returns null when the signature is invalid. */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ParsedWebhook | null;
  refund(input: { reference: string; amountMinor: number; reason: string }): Promise<RefundResult>;
  fetchRefund(providerRefundId: string): Promise<RefundResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
