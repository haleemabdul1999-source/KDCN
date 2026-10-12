import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma.service';
import { MerchantVerificationService } from '../merchants/merchant-verification.service';
import { NotificationService } from '../notifications/notification.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { RefundsService } from '../payments/refunds.service';

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<number>;
}

/**
 * In-process scheduler for time-based work. A lease row per job (job_leases) ensures only one
 * API instance runs a given job at a time, so horizontal scaling stays safe without Redis.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly owner = randomUUID();
  private timers: NodeJS.Timeout[] = [];
  private readonly lastRun = new Map<string, { at: Date; result: number | string }>();
  readonly jobs: Job[];

  constructor(
    private readonly prisma: PrismaService,
    orders: OrdersService,
    payments: PaymentsService,
    refunds: RefundsService,
    notifications: NotificationService,
    verification: MerchantVerificationService,
  ) {
    this.jobs = [
      { name: 'notifications.dispatch', everyMs: 15_000, run: () => notifications.dispatchPending() },
      { name: 'orders.expire_confirmations', everyMs: 60_000, run: () => orders.expireConfirmations() },
      { name: 'orders.expire_payments', everyMs: 60_000, run: () => orders.expirePayments((ref) => payments.verifyAndApply(ref, 'expiry_job')) },
      { name: 'orders.auto_complete', everyMs: 10 * 60_000, run: () => orders.autoComplete() },
      { name: 'refunds.process', everyMs: 60_000, run: () => refunds.processDue() },
      { name: 'merchants.expire_verifications', everyMs: 60 * 60_000, run: () => verification.expireVerifications() },
    ];
  }

  onApplicationBootstrap() {
    if (!env().JOBS_ENABLED) return;
    for (const job of this.jobs) {
      this.timers.push(setInterval(() => void this.runJob(job.name), job.everyMs).unref());
    }
  }

  onApplicationShutdown() {
    this.timers.forEach(clearInterval);
  }

  async runJob(name: string): Promise<number | null> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`Unknown job ${name}`);
    const leaseUntil = new Date(Date.now() + Math.max(job.everyMs, 30_000));
    const got = await this.prisma.$executeRaw`
      INSERT INTO job_leases (name, owner, "lockedUntil") VALUES (${name}, ${this.owner}, ${leaseUntil})
      ON CONFLICT (name) DO UPDATE SET owner = ${this.owner}, "lockedUntil" = ${leaseUntil}
      WHERE job_leases."lockedUntil" < now() OR job_leases.owner = ${this.owner}`;
    if (got !== 1) return null;
    try {
      const n = await job.run();
      this.lastRun.set(name, { at: new Date(), result: n });
      if (n > 0) this.logger.log({ msg: 'job.completed', job: name, processed: n });
      return n;
    } catch (e) {
      this.lastRun.set(name, { at: new Date(), result: `error: ${(e as Error).message}` });
      this.logger.error({ msg: 'job.failed', job: name, error: (e as Error).message });
      return null;
    } finally {
      await this.prisma.jobLease.updateMany({ where: { name, owner: this.owner }, data: { lockedUntil: new Date(0) } });
    }
  }

  status() {
    return this.jobs.map((j) => ({ name: j.name, everyMs: j.everyMs, lastRun: this.lastRun.get(j.name) ?? null }));
  }
}
