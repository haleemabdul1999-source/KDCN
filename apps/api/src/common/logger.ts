import { LoggerService } from '@nestjs/common';

/**
 * Structured JSON logger (one JSON object per line) suitable for log aggregation.
 * Never log secrets, payment card data, residential addresses or verification documents.
 */
export class JsonLogger implements LoggerService {
  constructor(private readonly minLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {}

  private static order = { debug: 10, info: 20, warn: 30, error: 40 } as const;

  private write(
    level: keyof typeof JsonLogger.order,
    message: unknown,
    context?: string,
    extra?: unknown,
  ) {
    if (JsonLogger.order[level] < JsonLogger.order[this.minLevel]) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      context,
      msg: typeof message === 'string' ? message : undefined,
    };
    if (typeof message === 'object' && message !== null) Object.assign(entry, message);
    if (extra) entry.extra = extra;
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }
  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, context, trace ? { trace } : undefined);
  }
  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
}
