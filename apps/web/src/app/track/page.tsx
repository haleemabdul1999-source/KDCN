'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { api, ApiError, saveOrderToken } from '@/lib/api';

export default function TrackPage() {
  const router = useRouter();
  const [number, setNumber] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card"
      style={{ maxWidth: 480, margin: '0 auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const o = await api<{ id: string }>('/orders/track', { body: { number, token } });
          saveOrderToken(o.id, token);
          router.push(`/orders/${o.id}`);
        } catch (err) {
          setError(
            err instanceof ApiError && err.status === 404
              ? 'We could not find an order with those details.'
              : 'Something went wrong.',
          );
        }
      }}
    >
      <h1>Track an order</h1>
      <p className="small muted">
        Signed-in customers can see all orders under “Account”. Guest orders: use the order number
        and tracking key from your confirmation email.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="field">
        <label htmlFor="num">Order number</label>
        <input
          id="num"
          required
          placeholder="KD261012-ABC123"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="tok">Tracking key</label>
        <input id="tok" required value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      <button className="btn btn-block">Find my order</button>
    </form>
  );
}
