import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma.service';
import { MockPaymentProvider } from './providers/mock.provider';
import { PaymentProviderAdapter } from './providers/payment-provider';
import { PaystackProvider } from './providers/paystack.provider';

/** Resolves provider adapters. The active provider is chosen by PAYMENT_PROVIDER. */
@Injectable()
export class ProviderRegistry {
  private readonly adapters = new Map<PaymentProvider, PaymentProviderAdapter>();

  constructor(prisma: PrismaService) {
    const e = env();
    if (e.PAYMENT_PROVIDER === 'mock' || e.NODE_ENV !== 'production') {
      this.adapters.set(PaymentProvider.MOCK, new MockPaymentProvider(prisma));
    }
    if (e.PAYSTACK_SECRET_KEY) {
      this.adapters.set(
        PaymentProvider.PAYSTACK,
        new PaystackProvider(e.PAYSTACK_SECRET_KEY, e.PAYSTACK_BASE_URL),
      );
    }
  }

  active(): PaymentProviderAdapter {
    return this.get(
      env().PAYMENT_PROVIDER === 'paystack' ? PaymentProvider.PAYSTACK : PaymentProvider.MOCK,
    );
  }

  get(id: PaymentProvider): PaymentProviderAdapter {
    const a = this.adapters.get(id);
    if (!a) throw new Error(`Payment provider ${id} is not configured`);
    return a;
  }

  has(id: PaymentProvider): boolean {
    return this.adapters.has(id);
  }

  mock(): MockPaymentProvider | null {
    const a = this.adapters.get(PaymentProvider.MOCK);
    return a instanceof MockPaymentProvider ? a : null;
  }
}
