// Test environment. Uses a separate database (kdcn_test by default).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://kdcn:kdcn@localhost:5432/kdcn_test';
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY ?? 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.APP_SECRET = 'test-app-secret-0123456789abcdef0123456789';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.JOBS_ENABLED = 'false';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? '/tmp/kdcn-test-storage';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '100000';
process.env.WEB_BASE_URL = 'http://localhost:3000';
process.env.CHECKOUT_RATE_LIMIT_PER_MINUTE = '100000';
