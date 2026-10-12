'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { naira } from '@/lib/format';

/**
 * TEST MODE hosted payment page for the deterministic mock provider. It stands in for the real
 * provider's checkout page in development and automated tests. No money moves.
 */
export default function MockPayPage() {
  const { reference } = useParams<{ reference: string }>();
  const [charge, setCharge] = useState<{
    amountMinor: number;
    status: string;
    order: { number: string } | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<typeof charge>(`/payments/mock/${encodeURIComponent(reference)}`)
      .then(setCharge)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Unknown payment'));
  }, [reference]);

  const complete = async (outcome: 'success' | 'failed' | 'abandoned') => {
    setBusy(true);
    try {
      const r = await api<{ redirectUrl: string }>(
        `/payments/mock/${encodeURIComponent(reference)}/complete`,
        { body: { outcome } },
      );
      window.location.href = r.redirectUrl;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
      setBusy(false);
    }
  };

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!charge) return <Loading />;
  return (
    <div className="card stack" style={{ maxWidth: 460, margin: '0 auto' }}>
      <div className="test-banner">
        TEST MODE — simulated payment provider. No real money is charged.
      </div>
      <h1>KDCN Test Payment</h1>
      <p>
        Order <strong>{charge.order?.number}</strong>
      </p>
      <p className="price" style={{ fontSize: '2rem' }}>
        {naira(charge.amountMinor)}
      </p>
      {charge.status !== 'pending' ? (
        <Alert tone="info">This test payment is already {charge.status}.</Alert>
      ) : (
        <div className="stack-sm">
          <button className="btn btn-block" disabled={busy} onClick={() => complete('success')}>
            Simulate successful payment
          </button>
          <button
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() => complete('failed')}
          >
            Simulate declined payment
          </button>
          <button
            className="btn btn-link btn-block"
            disabled={busy}
            onClick={() => complete('abandoned')}
          >
            Cancel and return
          </button>
        </div>
      )}
    </div>
  );
}
