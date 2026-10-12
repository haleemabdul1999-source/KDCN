import 'reflect-metadata';
import { createApp } from './bootstrap';
import { env } from './config/env';

async function main() {
  const e = env(); // validates configuration before anything else
  const app = await createApp();
  await app.listen(e.PORT);
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'api.listening', port: e.PORT, paymentProvider: e.PAYMENT_PROVIDER }) + '\n');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
