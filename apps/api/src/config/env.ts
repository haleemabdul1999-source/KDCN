import { z } from 'zod';

/**
 * Environment validation. The process refuses to start with an invalid configuration.
 * Every variable is documented in docs/ENVIRONMENT.md.
 */
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    /** Public base URL of the web app, used for payment callback and email links. */
    WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
    /** Public base URL of the API (for building provider callback/webhook URLs). */
    API_BASE_URL: z.string().url().default('http://localhost:4000'),
    /** 32-byte key, base64 encoded, for AES-256-GCM encryption of confidential fields. */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded'),
    /** Secret used to salt analytics visitor hashes and guest tokens. */
    APP_SECRET: z.string().min(32),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 14),
    STAFF_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: bool.default('false'),

    PAYMENT_PROVIDER: z.enum(['mock', 'paystack']).default('mock'),
    MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('mock-webhook-secret-dev-only'),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),

    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),

    NOTIFY_EMAIL_DRIVER: z.enum(['log', 'disabled']).default('log'),
    NOTIFY_SMS_DRIVER: z.enum(['log', 'disabled']).default('log'),

    /** Minutes the merchant has to confirm availability before the order auto-cancels. */
    CONFIRMATION_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 60),
    /** Minutes the customer has to pay after confirmation before the order auto-cancels. */
    PAYMENT_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(6 * 60),
    /** Days after delivery/collection before an order auto-completes if no dispute is opened. */
    AUTO_COMPLETE_DAYS: z.coerce.number().int().positive().default(3),
    JOBS_ENABLED: bool.default('true'),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    CHECKOUT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'paystack' && !env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYSTACK_SECRET_KEY'],
        message: 'required when PAYMENT_PROVIDER=paystack',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.PAYMENT_PROVIDER === 'mock') {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_PROVIDER'],
          message: 'mock provider is not allowed in production',
        });
      }
      if (env.APP_SECRET.includes('dev-only')) {
        ctx.addIssue({
          code: 'custom',
          path: ['APP_SECRET'],
          message: 'development secret used in production',
        });
      }
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function cookieSecure(): boolean {
  const e = env();
  return e.COOKIE_SECURE ?? e.NODE_ENV === 'production';
}
