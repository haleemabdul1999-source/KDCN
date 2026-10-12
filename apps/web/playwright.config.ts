import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real API (mock payment provider) and the production web build
 * against a dedicated database (kdcn_e2e by default) that should be empty before the first run.
 *
 *   pnpm --filter @kdcn/api build && pnpm --filter @kdcn/web build && pnpm test:e2e
 */
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://kdcn:kdcn@localhost:5432/kdcn_e2e';
const apiEnv = {
  NODE_ENV: 'development',
  PORT: '4100',
  DATABASE_URL: E2E_DB,
  WEB_BASE_URL: 'http://localhost:3100',
  DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  APP_SECRET: 'e2e-app-secret-0123456789abcdef0123456789',
  PAYMENT_PROVIDER: 'mock',
  JOBS_ENABLED: 'false',
  STORAGE_LOCAL_DIR: '/tmp/kdcn-e2e-storage',
  RATE_LIMIT_PER_MINUTE: '10000',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  CHECKOUT_RATE_LIMIT_PER_MINUTE: '1000',
  SEED_ADMIN_EMAIL: 'admin@demo.kdcn.ng',
  SEED_ADMIN_PASSWORD: 'AdminPassword123!',
  SEED_ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  SEED_DEMO: 'true',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testMatch: /admin|merchant/ },
  ],
  webServer: [
    {
      // Non-destructive: apply migrations and the idempotent seed, then start the API.
      // Point E2E_DATABASE_URL at a fresh, empty database (CI creates one per run).
      command:
        'cd ../api && npx prisma migrate deploy && node dist/seed/seed.js && node dist/main.js',
      url: 'http://localhost:4100/api/health/ready',
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx next start -p 3100',
      url: 'http://localhost:3100',
      env: { API_INTERNAL_URL: 'http://localhost:4100' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
export { apiEnv, E2E_DB };
