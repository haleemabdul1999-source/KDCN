'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Loading } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Landing page after the payment provider redirects back. The redirect proves nothing: we ask
 * the API to verify the payment server-side with the provider, and show what it reports.
 */
function PaymentReturn() {
  const { id } = useParams<{ id: string }>();
  const reference = useSearchParams().get('reference');
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    if (!reference) return;
    let attempts = 0;
    let stopped = false;
    const check = async () => {
      attempts++;
      try {
        const r = await api<{ outcome: string }>(`/orders/${id}/verify-payment`, { body: { reference } });
        if (stopped) return;
        setOutcome(r.outcome);
        if ((r.outcome === 'pending' || r.outcome === 'verification_unavailable') && attempts < 6) setTimeout(check, 2500);
      } catch {
        if (!stopped) setOutcome('error');
      }
    };
    void check();
    return () => {
      stopped = true;
    };
  }, [id, reference]);

  if (!reference) return <Alert tone="error">Missing payment reference.</Alert>;
  if (!outcome || outcome === 'pending') return <Loading label="Confirming your payment with the provider" />;
  const ok = outcome === 'paid' || outcome === 'already_applied';
  return (
    <div className="card stack" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
      {ok ? (
        <>
          <h1>Payment confirmed</h1>
          <p>Thank you! The seller has been notified and will prepare your order.</p>
        </>
      ) : outcome === 'failed' ? (
        <>
          <h1>Payment not completed</h1>
          <p>Your payment didn&apos;t go through and you haven&apos;t been charged. You can try again from your order page.</p>
        </>
      ) : outcome.endsWith('refund_raised') ? (
        <Alert tone="warn" title="We received an extra payment">This order was already paid or had been cancelled, so this payment will be refunded automatically.</Alert>
      ) : (
        <Alert tone="warn" title="We couldn’t confirm your payment yet">If money left your account, it will be matched to your order automatically once the provider confirms it. Please check your order page shortly.</Alert>
      )}
      <Link className="btn" href={`/orders/${id}`}>
        View order
      </Link>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PaymentReturn />
    </Suspense>
  );
}
