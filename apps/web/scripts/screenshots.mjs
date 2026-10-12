/** Capture documentation screenshots from a running stack seeded with demo data. */
import { createHmac } from 'node:crypto';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? '../../docs/screenshots';
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);

function totp(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0,
    value = 0;
  const out = [];
  for (const c of secret) {
    value = (value << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', Buffer.from(out)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
}
async function login(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const mobile = await browser.newContext({ ...devices['Pixel 7'] });
const m = await mobile.newPage();
for (const [name, path] of [
  ['mobile-home', '/'],
  ['mobile-search', '/search?q=ankara'],
  ['mobile-product', '/p/zainab-fabrics-1'],
  ['mobile-storefront-home-vendor', '/s/amina-bakes'],
  ['mobile-galaxy-mall', '/markets/galaxy-mall'],
]) {
  await m.goto(BASE + path, { waitUntil: 'networkidle' });
  await m.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}
const desk = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const d = await desk.newPage();
await login(d, 'galaxy.merchant@demo.kdcn.ng', 'Password123!');
await d.waitForURL(/\/$/);
const me = await (await d.request.get(`${BASE}/api/auth/me`)).json();
const mid = me.user.merchants[0].id;
for (const [name, path] of [
  ['merchant-overview', `/merchant/${mid}`],
  ['merchant-orders', `/merchant/${mid}/orders?bucket=all`],
  ['merchant-payouts', `/merchant/${mid}/payouts`],
  ['merchant-new-product', `/merchant/${mid}/products/new`],
]) {
  await d.goto(BASE + path, { waitUntil: 'networkidle' });
  await d.screenshot({ path: `${OUT}/${name}.png` });
}
const a = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
await login(a, 'admin@demo.kdcn.ng', 'AdminPassword123!');
await a.getByLabel('6-digit code').fill(totp('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'));
await a.getByRole('button', { name: 'Verify' }).click();
await a.waitForURL(/\/admin/);
await a.waitForLoadState('networkidle');
await a.screenshot({ path: `${OUT}/admin-overview.png`, fullPage: true });
const o = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await login(o, 'operator@demo.kdcn.ng', 'Password123!');
await o.waitForURL(/\/$/);
const ome = await (await o.request.get(`${BASE}/api/auth/me`)).json();
await o.goto(`${BASE}/operator/${ome.user.markets[0].id}`, { waitUntil: 'networkidle' });
await o.screenshot({ path: `${OUT}/operator-portal.png` });
await browser.close();
console.log('screenshots written to', OUT);
