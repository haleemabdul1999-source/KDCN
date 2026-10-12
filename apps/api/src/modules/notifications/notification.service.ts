import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { PrismaService, Tx } from '../../common/prisma.service';
import { ChannelAdapter, LogAdapter } from './notification.adapters';

export interface NotifyInput {
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  template: string;
  subject: string;
  body: string;
  data?: Record<string, unknown>;
  /** Channels besides IN_APP. Defaults to email only. */
  channels?: NotificationChannel[];
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly adapters: Partial<Record<NotificationChannel, ChannelAdapter>> = {};

  constructor(private readonly prisma: PrismaService) {
    if (env().NOTIFY_EMAIL_DRIVER === 'log') this.adapters.EMAIL = new LogAdapter('email');
    if (env().NOTIFY_SMS_DRIVER === 'log') this.adapters.SMS = new LogAdapter('sms');
  }

  /** Write notifications to the outbox inside the caller's transaction. */
  async enqueue(input: NotifyInput, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    const data = (input.data ?? {}) as Prisma.InputJsonValue;
    const rows: Prisma.NotificationCreateManyInput[] = [];
    if (input.userId) {
      rows.push({
        userId: input.userId,
        channel: NotificationChannel.IN_APP,
        recipient: input.userId,
        template: input.template,
        subject: input.subject,
        body: input.body,
        data,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      });
    }
    for (const channel of input.channels ?? [NotificationChannel.EMAIL]) {
      const recipient = channel === NotificationChannel.EMAIL ? input.email : input.phone;
      if (!recipient) continue;
      rows.push({
        userId: input.userId ?? null,
        channel,
        recipient,
        template: input.template,
        subject: input.subject,
        body: input.body,
        data,
      });
    }
    if (rows.length) await client.notification.createMany({ data: rows });
  }

  /** Deliver pending outbox messages. Called by the job runner; safe to run repeatedly. */
  async dispatchPending(limit = 50): Promise<number> {
    const pending = await this.prisma.notification.findMany({
      where: { status: NotificationStatus.PENDING, attempts: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let sent = 0;
    for (const n of pending) {
      const adapter = this.adapters[n.channel];
      // Claim the row first so concurrent dispatchers don't double-send.
      const claimed = await this.prisma.notification.updateMany({
        where: { id: n.id, status: NotificationStatus.PENDING, attempts: n.attempts },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;
      if (!adapter) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { status: NotificationStatus.SKIPPED, lastError: 'channel disabled' } });
        continue;
      }
      try {
        await adapter.send({ recipient: n.recipient, subject: n.subject, body: n.body });
        await this.prisma.notification.update({ where: { id: n.id }, data: { status: NotificationStatus.SENT, sentAt: new Date() } });
        sent++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn({ msg: 'notification.failed', id: n.id, error: message });
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { lastError: message.slice(0, 500), status: n.attempts + 1 >= 5 ? NotificationStatus.FAILED : NotificationStatus.PENDING },
        });
      }
    }
    return sent;
  }
}
