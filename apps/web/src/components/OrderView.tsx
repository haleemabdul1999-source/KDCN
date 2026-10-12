'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { date, FULFILMENT_LABEL, naira } from '@/lib/format';
import { Alert, StatusBadge } from './ui';

export interface CustomerOrder {
  id: string;
  number: string;
  status: string;
  statusLabel: string;
  merchant: { slug: string; displayName: string; contactPhone?: string };
  items: { id: string; title: string; variantName: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number; leadTimeDays: number }[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  totalMinor: number;
  fulfilmentMethod: string;
  cancellationReason: string | null;
  merchantNote: string | null;
  confirmationDeadline: string | null;
  paymentDeadline: string | null;
  createdAt: string;
  terms: { platform?: string; cancellationPolicy?: string; returnPolicy?: string; fulfilment?: { location?: { label: string; address: string }; collectionPoint?: { name: string; address: string } } };
  timeline: { status: string; label: string; note: string | null; at: string }[];
  payments: { reference: string; status: string; amountMinor: number; testMode: boolean; isDuplicate: boolean; failureReason: string | null }[];
  refunds: { id: string; amountMinor: number; status: string; reason: string }[];
  refundedMinor: number;
  fulfilment: {
    method: string;
    status: string;
    collectionPoint: { name: string; address: string; openingHours: string } | null;
    collectionCode: string | null;
    deliveryAddress: string | null;
    rider: { partner: string; name: string | null; phone: string | null } | null;
    failedAttempts: number;
  } | null;
  dispute: { id: string; status: string; reason: string; resolution: string | null; messages: { id: string; authorRole: string; body: string; createdAt: string }[] } | null;
  review: { rating: number; body: string; merchantResponse: string | null } | null;
  actions: { canPay: boolean; canCancel: boolean; canConfirmReceipt: boolean; canDispute: boolean; canReview: boolean };
}

export function OrderSummary({ o }: { o: CustomerOrder }) {
  return (
    <section className="card">
      <h2>Items</h2>
      {o.items.map((i) => (
        <div key={i.id} className="summary-line small">
          <span>
            {i.quantity} × {i.title} <span className="meta">({i.variantName})</span>
          </span>
          <span>{naira(i.lineTotalMinor)}</span>
        </div>
      ))}
      <div className="summary-line" style={{ marginTop: 8 }}>
        <span>Subtotal</span>
        <span>{naira(o.subtotalMinor)}</span>
      </div>
      <div className="summary-line">
        <span>{FULFILMENT_LABEL[o.fulfilmentMethod]}</span>
        <span>{o.deliveryFeeMinor ? naira(o.deliveryFeeMinor) : 'Free'}</span>
      </div>
      <div className="summary-line">
        <span>Service fee</span>
        <span>{naira(o.serviceFeeMinor)}</span>
      </div>
      <div className="summary-line summary-total">
        <span>Total</span>
        <span>{naira(o.totalMinor)}</span>
      </div>
      {o.refundedMinor > 0 && (
        <div className="summary-line" style={{ color: 'var(--green-800)' }}>
          <span>Refunded</span>
          <span>−{naira(o.refundedMinor)}</span>
        </div>
      )}
    </section>
  );
}

export function Timeline({ events }: { events: { label: string; note: string | null; at: string }[] }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={i}>
          <strong className="small">{e.label}</strong> <span className="meta">{date(e.at, true)}</span>
          {e.note && <div className="meta">{e.note}</div>}
        </li>
      ))}
    </ol>
  );
}

export function CustomerOrderActions({ o, onChange }: { o: CustomerOrder; onChange: (o: CustomerOrder) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'cancel' | 'dispute' | 'review'>('none');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('not_as_described');
  const [rating, setRating] = useState(5);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode('none');
      setText('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-sm">
      {error && <Alert tone="error">{error}</Alert>}
      {o.actions.canPay && (
        <button
          className="btn btn-amber btn-block"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ authorizationUrl: string }>(`/orders/${o.id}/pay`, { method: 'POST' });
              window.location.href = r.authorizationUrl;
            })
          }
        >
          {busy ? 'Starting payment…' : `Pay ${naira(o.totalMinor)} securely`}
        </button>
      )}
      {o.actions.canConfirmReceipt && (
        <button className="btn btn-block" disabled={busy} onClick={() => run(async () => onChange(await api(`/orders/${o.id}/confirm-receipt`, { method: 'POST' })))}>
          I&apos;ve received my order
        </button>
      )}
      {o.actions.canReview && mode !== 'review' && (
        <button className="btn btn-secondary btn-block" onClick={() => setMode('review')}>
          Review this order
        </button>
      )}
      {mode === 'review' && (
        <form className="card-flat stack-sm" onSubmit={(e) => (e.preventDefault(), run(async () => onChange(await api(`/orders/${o.id}/review`, { body: { rating, body: text } }))))}>
          <label htmlFor="rating">Rating</label>
          <select id="rating" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>
                {'★'.repeat(r)} ({r})
              </option>
            ))}
          </select>
          <label htmlFor="rev">Your review</label>
          <textarea id="rev" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          <button className="btn btn-sm" disabled={busy}>
            Submit review
          </button>
        </form>
      )}
      {o.actions.canCancel && mode !== 'cancel' && (
        <button className="btn btn-secondary btn-block" onClick={() => setMode('cancel')}>
          Cancel order
        </button>
      )}
      {mode === 'cancel' && (
        <form className="card-flat stack-sm" onSubmit={(e) => (e.preventDefault(), run(async () => onChange(await api(`/orders/${o.id}/cancel`, { body: { reason: text } }))))}>
          <label htmlFor="cr">Reason (optional)</label>
          <input id="cr" type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
          <p className="small mb-0">{o.status === 'PAID' ? 'You will receive a full refund to your original payment method.' : 'You have not been charged.'}</p>
          <div className="row">
            <button className="btn btn-danger btn-sm" disabled={busy}>
              Confirm cancellation
            </button>
            <button type="button" className="btn btn-link" onClick={() => setMode('none')}>
              Keep order
            </button>
          </div>
        </form>
      )}
      {o.actions.canDispute && mode !== 'dispute' && (
        <button className="btn btn-link" onClick={() => setMode('dispute')}>
          Report a problem with this order
        </button>
      )}
      {mode === 'dispute' && (
        <form className="card-flat stack-sm" onSubmit={(e) => (e.preventDefault(), run(async () => onChange(await api(`/orders/${o.id}/disputes`, { body: { reason, description: text } }))))}>
          <label htmlFor="dr">What went wrong?</label>
          <select id="dr" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="not_received">I didn&apos;t receive it</option>
            <option value="not_as_described">Not as described</option>
            <option value="damaged">Damaged</option>
            <option value="wrong_item">Wrong item</option>
            <option value="cancellation_request">I want to cancel</option>
            <option value="other">Something else</option>
          </select>
          <label htmlFor="dd">Describe the problem</label>
          <textarea id="dd" value={text} onChange={(e) => setText(e.target.value)} minLength={10} required />
          <p className="small muted mb-0">The seller is notified and KDCN support reviews every dispute.</p>
          <button className="btn btn-sm" disabled={busy}>
            Open dispute
          </button>
        </form>
      )}
    </div>
  );
}

export function OrderHeader({ o }: { o: CustomerOrder }) {
  const test = o.payments.some((p) => p.testMode);
  return (
    <div className="row-between">
      <div>
        <h1 style={{ marginBottom: 4 }}>Order {o.number}</h1>
        <div className="meta">
          From <Link href={`/s/${o.merchant.slug}`}>{o.merchant.displayName}</Link> · placed {date(o.createdAt, true)}
        </div>
      </div>
      <div className="row">
        {test && <span className="badge badge-test">TEST PAYMENT</span>}
        <StatusBadge status={o.status} label={o.statusLabel} />
      </div>
    </div>
  );
}
