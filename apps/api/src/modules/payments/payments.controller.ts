import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { Public, SkipCsrf } from '../../common/auth/decorators';
import { KdcnRequest } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { parse } from '../../common/validation';
import { PaymentsService } from './payments.service';
import { ProviderRegistry } from './provider.registry';
import { MockPaymentProvider } from './providers/mock.provider';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: ProviderRegistry,
    private readonly prisma: PrismaService,
  ) {}

  /** Provider webhooks. Authenticated by HMAC signature over the raw body, not by session. */
  @Public()
  @SkipCsrf()
  @SkipThrottle()
  @Post('webhooks/:provider')
  async webhook(
    @Param('provider') providerParam: string,
    @Req() req: KdcnRequest,
    @Res() res: Response,
  ) {
    const provider = providerParam.toUpperCase();
    if (!(provider in PaymentProvider)) throw new NotFoundException();
    const raw = req.rawBody ?? Buffer.alloc(0);
    const result = await this.payments.handleWebhook(provider as PaymentProvider, raw, req.headers);
    res.status(result.status).json({ result: result.result });
  }

  // ── Mock provider (development / test only) ────────────────────────────

  private mock(): MockPaymentProvider {
    const m = this.providers.mock();
    if (!m || env().PAYMENT_PROVIDER !== 'mock')
      throw new ForbiddenException('Mock payments are disabled');
    return m;
  }

  /** Details for the TEST MODE hosted payment page. */
  @Public()
  @Get('mock/:reference')
  async mockCharge(@Param('reference') reference: string) {
    this.mock();
    const c = await this.prisma.mockProviderCharge.findUnique({ where: { reference } });
    if (!c) throw new NotFoundException();
    const p = await this.prisma.paymentTransaction.findUnique({
      where: { reference },
      include: { order: { select: { id: true, number: true } } },
    });
    return {
      reference,
      amountMinor: c.amountMinor,
      currency: c.currency,
      status: c.status,
      testMode: true,
      order: p?.order ?? null,
    };
  }

  /**
   * Simulates the customer completing payment on the provider's page. The provider then sends a
   * signed webhook (delivered here in-process through the normal webhook handler) and redirects
   * the customer to the callback URL, where the web app asks the API to verify.
   */
  @Public()
  @Post('mock/:reference/complete')
  @HttpCode(200)
  async mockComplete(@Param('reference') reference: string, @Body() body: unknown) {
    const mock = this.mock();
    const { outcome, sendWebhook } = parse(
      z.object({
        outcome: z.enum(['success', 'failed', 'abandoned']),
        sendWebhook: z.boolean().default(true),
      }),
      body,
    );
    const charge = await mock.completeCharge(reference, outcome);
    if (!charge) throw new NotFoundException();
    let webhookResult: string | null = null;
    if (sendWebhook) {
      const { body: raw, headers } = MockPaymentProvider.signedWebhook(
        outcome === 'success' ? 'charge.success' : 'charge.failed',
        { reference, status: outcome, amount: charge.amountMinor },
      );
      webhookResult = (await this.payments.handleWebhook(PaymentProvider.MOCK, raw, headers))
        .result;
    }
    const p = await this.prisma.paymentTransaction.findUnique({ where: { reference } });
    return {
      status: charge.status,
      webhookResult,
      redirectUrl: p
        ? `${env().WEB_BASE_URL}/orders/${p.orderId}/payment-return?reference=${encodeURIComponent(reference)}`
        : null,
    };
  }
}
