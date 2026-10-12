import { INestApplication } from '@nestjs/common';
import { PrismaClient, StaffRole } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { encryptField, hashPassword, totp } from '../src/common/crypto';
import { PrismaService } from '../src/common/prisma.service';
import { seedReference } from '../src/seed/seed';

export const ADMIN_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  ref: Awaited<ReturnType<typeof seedReference>>;
}

export async function setupApp(): Promise<TestCtx> {
  const app = await createApp({ logger: false });
  await app.init();
  const prisma = app.get(PrismaService);
  await resetDb(prisma);
  const ref = await seedReference(prisma as unknown as PrismaClient);
  return { app, prisma, ref };
}

export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE does not fire the row-level append-only triggers.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

/** A cookie-carrying client that adds the CSRF header to every request. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  orderToken?: string;
  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }
  private h<T extends request.Test>(t: T): T {
    t.set('x-kdcn-csrf', '1');
    if (this.orderToken) t.set('x-kdcn-order-token', this.orderToken);
    return t;
  }
  get(url: string) {
    return this.h(this.agent.get(`/api${url}`));
  }
  post(url: string, body?: object) {
    return this.h(this.agent.post(`/api${url}`)).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.h(this.agent.patch(`/api${url}`)).send(body ?? {});
  }
  put(url: string, body?: object) {
    return this.h(this.agent.put(`/api${url}`)).send(body ?? {});
  }
  delete(url: string) {
    return this.h(this.agent.delete(`/api${url}`));
  }
  upload(url: string, field: string, buf: Buffer, filename: string, fields: Record<string, string> = {}) {
    let t = this.h(this.agent.post(`/api${url}`));
    for (const [k, v] of Object.entries(fields)) t = t.field(k, v);
    return t.attach(field, buf, filename);
  }
}

let counter = 0;
export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${++counter}@test.kdcn.ng`;
}

export async function registerCustomer(app: INestApplication, name = 'Test Customer') {
  const c = new Client(app);
  const email = uniqueEmail('customer');
  const res = await c.post('/auth/register', { name, email, password: 'Password1234', phone: '08031234567' });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return { client: c, email, userId: res.body.user.id as string };
}

export async function staffClient(ctx: TestCtx, roles: StaffRole[] = [StaffRole.SUPER_ADMIN]) {
  const email = uniqueEmail('staff');
  await ctx.prisma.user.create({
    data: { email, name: 'Staff', passwordHash: await hashPassword('StaffPassword123'), staffRoles: roles, mfaSecretEnc: encryptField(ADMIN_TOTP), mfaEnabled: true },
  });
  const c = new Client(ctx.app);
  const login = await c.post('/auth/login', { email, password: 'StaffPassword123' });
  if (login.status !== 200 || !login.body.mfaRequired) throw new Error('staff login failed');
  const v = await c.post('/auth/mfa/verify', { code: totp(ADMIN_TOTP) });
  if (v.status !== 200) throw new Error(`mfa failed ${JSON.stringify(v.body)}`);
  return c;
}

// Minimal valid 1x1 PNG and a JPEG with an EXIF (APP1) segment containing fake GPS text.
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export function jpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const exifPayload = Buffer.from('Exif\0\0GPSLatitude=10.5105;GPSLongitude=7.4165');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(exifPayload.length + 2) >> 8, (exifPayload.length + 2) & 0xff]), exifPayload]);
  const app0Payload = Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary');
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), Buffer.from([0, app0Payload.length + 2]), app0Payload]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9]);
  return Buffer.concat([soi, app0, app1, sos]);
}

export function idemKey() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
