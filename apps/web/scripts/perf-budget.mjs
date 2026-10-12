/**
 * Performance budget check under emulated constrained-mobile conditions (Chrome DevTools
 * Protocol): ~1.6 Mbps down / 750 Kbps up / 150 ms RTT ("regular 4G") and 4× CPU slowdown,
 * Pixel-class viewport. Usage (servers must be running):
 *   BASE_URL=http://localhost:3100 node scripts/perf-budget.mjs
 */
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PAGES = [
  '/',
  '/search?q=ankara',
  '/p/zainab-fabrics-1',
  '/s/amina-bakes',
  '/markets/galaxy-mall',
];
const BUDGET = { fcpMs: 2500, loadMs: 4000, jsKB: 150, totalKB: 500 };

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const results = [];
for (const path of PAGES) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let js = 0;
  let total = 0;
  cdp.on('Network.loadingFinished', (e) => (total += e.encodedDataLength));
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on(
    'Network.loadingFinished',
    (e) => types.get(e.requestId) === 'Script' && (js += e.encodedDataLength),
  );
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(500);
  const fcp = await page.evaluate(
    () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
  );
  const r = {
    path,
    fcpMs: fcp && Math.round(fcp),
    loadMs,
    jsKB: Math.round(js / 1024),
    totalKB: Math.round(total / 1024),
  };
  r.pass =
    r.fcpMs <= BUDGET.fcpMs &&
    r.loadMs <= BUDGET.loadMs &&
    r.jsKB <= BUDGET.jsKB &&
    r.totalKB <= BUDGET.totalKB;
  results.push(r);
  await context.close();
}
await browser.close();
console.log(
  `Budget: FCP ≤ ${BUDGET.fcpMs} ms, load ≤ ${BUDGET.loadMs} ms, JS ≤ ${BUDGET.jsKB} KB, total ≤ ${BUDGET.totalKB} KB (transferred, cold cache)`,
);
console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
