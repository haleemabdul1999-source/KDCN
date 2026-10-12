import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { env } from '../config/env';
import { Public } from '../common/auth/decorators';
import { PrismaService } from '../common/prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: process is up. */
  @Public()
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: database reachable and migrations applied. */
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const pending = await this.prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NULL`;
      if (Number(pending[0].n) > 0) throw new Error('migrations pending');
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return {
      status: 'ready',
      paymentProvider: env().PAYMENT_PROVIDER,
      paymentTestMode:
        env().PAYMENT_PROVIDER === 'mock' ||
        (env().PAYSTACK_SECRET_KEY ?? '').startsWith('sk_test_'),
    };
  }
}
