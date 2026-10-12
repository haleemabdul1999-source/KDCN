import { loadEnv } from '../../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  APP_SECRET: 'x'.repeat(40),
};

describe('environment validation', () => {
  it('accepts a minimal development configuration', () => {
    expect(loadEnv({ ...base } as NodeJS.ProcessEnv).PAYMENT_PROVIDER).toBe('mock');
  });
  it('refuses the mock payment provider in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /mock provider is not allowed in production/,
    );
  });
  it('requires a Paystack key when Paystack is selected', () => {
    expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: 'paystack' } as NodeJS.ProcessEnv)).toThrow(
      /PAYSTACK_SECRET_KEY/,
    );
  });
  it('rejects a malformed encryption key', () => {
    expect(() => loadEnv({ ...base, DATA_ENCRYPTION_KEY: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /32 bytes/,
    );
  });
});
