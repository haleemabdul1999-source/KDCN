import { Logger } from '@nestjs/common';

export interface OutboundMessage {
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Channel adapters. Release 1 ships `log` adapters only: messages are written to the
 * structured log (with the recipient masked) and marked SENT. Real email (SMTP/transactional
 * provider), SMS (e.g. Termii) and WhatsApp Business adapters implement the same interface once
 * credentials are provisioned. Nothing is delivered to real recipients by the log adapters.
 */
export interface ChannelAdapter {
  readonly name: string;
  send(msg: OutboundMessage): Promise<void>;
}

export function maskRecipient(r: string): string {
  if (r.includes('@')) {
    const [u, d] = r.split('@');
    return `${u.slice(0, 2)}***@${d}`;
  }
  return r.length > 4 ? `***${r.slice(-4)}` : '***';
}

export class LogAdapter implements ChannelAdapter {
  private readonly logger = new Logger('Notifications');
  constructor(readonly name: string) {}
  async send(msg: OutboundMessage): Promise<void> {
    this.logger.log({
      msg: 'notification.sent (log driver — not delivered)',
      channel: this.name,
      to: maskRecipient(msg.recipient),
      subject: msg.subject,
    });
  }
}
