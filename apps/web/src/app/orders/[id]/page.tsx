'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  CustomerOrderActions,
  OrderHeader,
  OrderSummary,
  Timeline,
  type CustomerOrder,
} from '@/components/OrderView';
import { Alert, Loading } from '@/components/ui';
import { api, ApiError, saveOrderToken } from '@/lib/api';
import { date, FULFILMENT_LABEL, naira } from '@/lib/format';

function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const token = useSearchParams().get('token');
  const [o, setO] = useState<CustomerOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (token) {
      saveOrderToken(id, token);
      // Keep the bearer token out of the address bar, history and screenshots.
      window.history.replaceState(null, '', `/orders/${id}`);
    }
    api<CustomerOrder>(`/orders/${id}`)
      .then(setO)
      .catch((e) =>
        setError(
          e instanceof ApiError && e.status === 400 ? 'Sign in to view this order.' : e.message,
        ),
      );
  }, [id, token]);

  if (error)
    return (
      <Alert tone="error">
        {error} <Link href={`/login?next=/orders/${id}`}>Sign in</Link>
      </Alert>
    );
  if (!o) return <Loading label="Loading order" />;
  const f = o.fulfilment;
  return (
    <div className="stack">
      <OrderHeader o={o} />
      {o.status === 'PENDING_MERCHANT_CONFIRMATION' && (
        <Alert tone="info" title="Waiting for the seller">
          The seller is confirming your items are available
          {o.confirmationDeadline ? ` (by ${date(o.confirmationDeadline, true)})` : ''}. We&apos;ll
          notify you when you can pay. If they don&apos;t confirm in time, the order is cancelled
          automatically and you&apos;re not charged.
        </Alert>
      )}
      {o.status === 'AWAITING_PAYMENT' && (
        <Alert tone="warn" title="Ready for payment">
          {o.merchantNote ? `Seller: “${o.merchantNote}”. ` : ''}Please pay
          {o.paymentDeadline ? ` by ${date(o.paymentDeadline, true)}` : ''} to secure your order.
        </Alert>
      )}
      {o.status === 'PAYMENT_PENDING_VERIFICATION' && (
        <Alert tone="info">
          We&apos;re waiting for confirmation from the payment provider. If you completed payment,
          this page will update shortly; otherwise you can try again.
        </Alert>
      )}
      {o.status === 'CANCELLED' && (
        <Alert tone="warn" title="Order cancelled">
          {o.cancellationReason}
        </Alert>
      )}
      {o.payments.some((p) => p.testMode) && (
        <Alert tone="warn">
          This order used the KDCN test payment provider. No real money was charged.
        </Alert>
      )}
      <div className="grid-main-side">
        <div className="stack">
          {f && (
            <section className="card stack-sm">
              <h2>{FULFILMENT_LABEL[f.method]}</h2>
              {f.collectionCode && (
                <>
                  <p className="small mb-0">
                    Show this collection code when you collect. Don&apos;t share it before you have
                    your items.
                  </p>
                  <div className="code-box" aria-label="Collection code">
                    {f.collectionCode}
                  </div>
                </>
              )}
              {o.terms.fulfilment?.location && (
                <p className="small mb-0">
                  Collect from: {o.terms.fulfilment.location.label} —{' '}
                  {o.terms.fulfilment.location.address}
                </p>
              )}
              {f.collectionPoint && (
                <p className="small mb-0">
                  Pickup point: <strong>{f.collectionPoint.name}</strong> —{' '}
                  {f.collectionPoint.address}{' '}
                  {f.collectionPoint.openingHours && `(${f.collectionPoint.openingHours})`}
                </p>
              )}
              {f.deliveryAddress && <p className="small mb-0">Deliver to: {f.deliveryAddress}</p>}
              {f.rider && (
                <p className="small mb-0">
                  Out for delivery with {f.rider.partner}
                  {f.rider.name ? ` — ${f.rider.name}` : ''}
                  {f.rider.phone ? ` (${f.rider.phone})` : ''}
                </p>
              )}
              {f.failedAttempts > 0 && (
                <Alert tone="warn">{f.failedAttempts} delivery attempt(s) were unsuccessful.</Alert>
              )}
            </section>
          )}
          <OrderSummary o={o} />
          {o.refunds.length > 0 && (
            <section className="card">
              <h2>Refunds</h2>
              {o.refunds.map((r) => (
                <div key={r.id} className="summary-line small">
                  <span>
                    {r.reason} — <strong>{r.status.toLowerCase()}</strong>
                  </span>
                  <span>{naira(r.amountMinor)}</span>
                </div>
              ))}
            </section>
          )}
          {o.dispute && (
            <section className="card stack-sm">
              <h2>Dispute — {o.dispute.status.replace(/_/g, ' ').toLowerCase()}</h2>
              {o.dispute.resolution && (
                <Alert tone="success">Resolution: {o.dispute.resolution}</Alert>
              )}
              {o.dispute.messages.map((m) => (
                <div key={m.id} className="card-flat small">
                  <strong>
                    {m.authorRole === 'customer'
                      ? 'You'
                      : m.authorRole === 'merchant'
                        ? 'Seller'
                        : 'KDCN support'}
                  </strong>{' '}
                  <span className="meta">{date(m.createdAt, true)}</span>
                  <div style={{ whiteSpace: 'pre-line' }}>{m.body}</div>
                </div>
              ))}
              {['OPEN', 'AWAITING_MERCHANT', 'UNDER_REVIEW'].includes(o.dispute.status) && (
                <form
                  className="stack-sm"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setO(
                      await api(`/orders/${o.id}/disputes/${o.dispute!.id}/messages`, {
                        body: { body: msg },
                      }),
                    );
                    setMsg('');
                  }}
                >
                  <label htmlFor="dm">Add a message</label>
                  <textarea id="dm" value={msg} onChange={(e) => setMsg(e.target.value)} required />
                  <button className="btn btn-sm btn-secondary">Send</button>
                </form>
              )}
            </section>
          )}
        </div>
        <aside className="stack">
          <section className="card">
            <CustomerOrderActions o={o} onChange={setO} />
            {!Object.values(o.actions).some(Boolean) && (
              <p className="small muted mb-0">No actions needed right now.</p>
            )}
          </section>
          <section className="card">
            <h2 style={{ fontSize: '1rem' }}>Progress</h2>
            <Timeline events={o.timeline} />
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <OrderPage />
    </Suspense>
  );
}
