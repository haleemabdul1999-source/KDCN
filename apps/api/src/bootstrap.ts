import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { env } from './config/env';
import { KdcnRequest } from './common/auth/auth.types';
import { JsonLogger } from './common/logger';

export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const e = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      opts.logger === false
        ? false
        : new JsonLogger(e.NODE_ENV === 'production' ? 'info' : 'debug'),
    bodyParser: false,
  });
  if (e.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  // Keep the raw body for webhook signature verification.
  app.use(
    json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as unknown as KdcnRequest).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(
    (req: KdcnRequest, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
      const incoming = req.headers['x-request-id'];
      req.requestId =
        typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
      res.setHeader('X-Request-Id', req.requestId);
      next();
    },
  );
  // The web app proxies /api/* to this service, so the browser sees a single origin.
  // CORS is therefore not enabled; cross-origin browser calls are rejected.
  app.setGlobalPrefix('api', { exclude: [] });
  app.enableShutdownHooks();
  return app;
}
