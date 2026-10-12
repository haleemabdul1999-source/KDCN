import type { NextRequest } from 'next/server';

/**
 * Same-origin API proxy: the browser calls /api/* on the web origin and this handler forwards to
 * the API service. Implemented as a route handler (not next.config rewrites) so the target is read
 * at runtime — one image can be promoted across environments.
 */
export const dynamic = 'force-dynamic';

const FORWARD_REQUEST_HEADERS = [
  'cookie',
  'content-type',
  'x-kdcn-csrf',
  'x-kdcn-order-token',
  'idempotency-key',
  'user-agent',
  'accept',
  'x-request-id',
  'x-paystack-signature',
  'x-mock-signature',
];
const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const url = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Preserve the client address chain for rate limiting and audit (API must set TRUST_PROXY=true).
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers.set('x-forwarded-for', fwd);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { statusCode: 502, message: 'The service is temporarily unavailable. Please try again.' },
      { status: 502 },
    );
  }
  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k) && k !== 'set-cookie') out.set(k, v);
  });
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
