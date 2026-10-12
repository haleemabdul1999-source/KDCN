'use client';

/** Browser API client. All calls are same-origin (/api/*, proxied by Next to the API service). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: {
      message?: string | string[];
      code?: string;
      errors?: { path: string; message: string }[];
      missing?: string[];
    } & Record<string, unknown>,
  ) {
    super(
      Array.isArray(body?.message)
        ? body.message.join(', ')
        : body?.message || `Request failed (${status})`,
    );
  }
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.body?.errors ?? []).map((e) => [e.path, e.message]));
  }
}

const TOKENS_KEY = 'kdcn_order_tokens';

export function saveOrderToken(orderId: string, token: string) {
  try {
    const all = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}');
    all[orderId] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

export function orderToken(orderId: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}')[orderId];
  } catch {
    return undefined;
  }
}

interface Opts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-kdcn-csrf': '1', ...opts.headers };
  const orderMatch = path.match(/^\/orders\/([0-9a-f-]{36})/);
  if (orderMatch) {
    const t = orderToken(orderMatch[1]);
    if (t) headers['x-kdcn-order-token'] = t;
  }
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, { message: 'Network error — check your connection and try again.' });
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export function newIdempotencyKey(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function track(type: string, data: Record<string, unknown> = {}) {
  // Fire-and-forget first-party analytics; failures are irrelevant to the user.
  api('/analytics/events', { body: { type, ...data } }).catch(() => undefined);
}
