'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Timeline } from '@/components/OrderView';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { date, FULFILMENT_LABEL, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface AdminOrder {
  id: string;
  number: string;
  status: string;
  segment: string;
  merchant: { displayName: string };
  merchantId: string;
  customer: { name: string; email: string | null; phone: string | null };
  items: { id: string; title: string; variantName: string; quantity: number; lineTotalMinor: number }[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  totalMinor: number;
  commissionBps: number;
  commissionMinor: number;
  fulfilmentMethod: string;
  fulfilment: { status: string; deliveryAddress: string | null; collectionPoint: { name: string } | null; failedAttempts: number } | null;
  payments: { id: string; reference: string; provider: string; status: string; amountMinor: number; providerFeeMinor: number | null; isDuplicate: boolean; testMode: boolean; failureReason: string | null; createdAt: string }[];
  refunds: { id: string; amountMinor: number; status: string; reason: string; createdAt: string }[];
  settlement: { status: string; merchantNetMinor: number; refundedMinor: number; mode: string } | null;
  timeline: { label: string; note: string | null; at: string; actor: string }[];
}

export default function AdminOrder() {
  const { id } = useParams<{ id: string }>();
  const { data: o, reload, loading, error } = useApi<AdminOrder>(`/admin/orders/${id}`);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const refundKey = useMemo(() => newIdempotencyKey(), []);
  if (loading) return <Loading />;
  if (error || !o) return <Alert tone="error">{error?.message}</Alert>;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    }
  };
  return (
    <div className="grid-main-side">
      <div className="stack">
        <h2>
          Order {o.number} <StatusBadge status={o.status} />
        </h2>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <section className="card">
          <dl className="kv">
            <dt>Merchant</dt>
            <dd>{o.merchant.displayName}</dd>
            <dt>Customer</dt>
            <dd>
              {o.customer.name} · {o.customer.email} · {o.customer.phone}
            </dd>
            <dt>Segment</dt>
            <dd>{o.segment}</dd>
            <dt>Fulfilment</dt>
            <dd>
              {FULFILMENT_LABEL[o.fulfilmentMethod]} · {o.fulfilment?.status.toLowerCase()} {o.fulfilment?.collectionPoint?.name} {o.fulfilment?.deliveryAddress}
            </dd>
            <dt>Totals</dt>
            <dd>
              Goods {naira(o.subtotalMinor)} + delivery {naira(o.deliveryFeeMinor)} + service {naira(o.serviceFeeMinor)} = <strong>{naira(o.totalMinor)}</strong>
            </dd>
            <dt>Commission</dt>
            <dd>
              {(o.commissionBps / 100).toFixed(2)}% = {naira(o.commissionMinor)}
            </dd>
            {o.settlement && (
              <>
                <dt>Settlement</dt>
                <dd>
                  {o.settlement.status} · merchant net {naira(o.settlement.merchantNetMinor)} · refunded {naira(o.settlement.refundedMinor)} · {o.settlement.mode}
                </dd>
              </>
            )}
          </dl>
          <ul className="small" style={{ marginTop: 12 }}>
            {o.items.map((i) => (
              <li key={i.id}>
                {i.quantity} × {i.title} ({i.variantName}) — {naira(i.lineTotalMinor)}
              </li>
            ))}
          </ul>
        </section>
        <section className="card stack-sm">
          <h3>Payments</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                  <th className="num">Fee</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {o.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="small">
                      {p.reference} {p.testMode && <span className="badge badge-test">TEST</span>} {p.isDuplicate && <span className="badge badge-red">duplicate</span>}
                      <div className="meta">{p.failureReason}</div>
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="num">{naira(p.amountMinor)}</td>
                    <td className="num">{naira(p.providerFeeMinor)}</td>
                    <td>
                      {p.status !== 'SUCCEEDED' && (
                        <button className="btn btn-sm btn-secondary" onClick={() => run(() => api(`/admin/payments/${encodeURIComponent(p.reference)}/reconcile`, { method: 'POST' }), 'Re-verified with provider')}>
                          Re-verify
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Refunds</h3>
          {o.refunds.length === 0 && <p className="muted small">None.</p>}
          {o.refunds.map((r) => (
            <div key={r.id} className="small">
              {naira(r.amountMinor)} — {r.reason} <StatusBadge status={r.status} /> <span className="meta">{date(r.createdAt)}</span>
            </div>
          ))}
        </section>
      </div>
      <aside className="stack">
        <section className="card stack-sm">
          <h3>Actions</h3>
          <label htmlFor="reason">Reason (audited)</label>
          <input id="reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          {!['CANCELLED', 'REFUNDED', 'REFUND_PENDING', 'COMPLETED', 'DELIVERED', 'DISPUTED'].includes(o.status) && (
            <button className="btn btn-danger btn-block" disabled={reason.length < 5} onClick={() => run(() => api(`/admin/orders/${o.id}/cancel`, { body: { reason } }), 'Order cancelled')}>
              Cancel order {o.status !== 'PENDING_MERCHANT_CONFIRMATION' && o.status !== 'AWAITING_PAYMENT' ? '(full refund)' : ''}
            </button>
          )}
          {o.payments.some((p) => p.status === 'SUCCEEDED') && (
            <>
              <label htmlFor="amt">Goodwill / partial refund (₦)</label>
              <input id="amt" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button className="btn btn-secondary btn-block" disabled={!amount || reason.length < 5} onClick={() => run(() => api(`/admin/orders/${o.id}/refunds`, { body: { amountMinor: Math.round(Number(amount) * 100), reason, idempotencyKey: refundKey } }), 'Refund requested — finance approval required')}>
                Request refund
              </button>
            </>
          )}
        </section>
        <section className="card">
          <h3>History</h3>
          <Timeline events={o.timeline.map((t) => ({ ...t, note: `${t.note ?? ''} (${t.actor})` }))} />
        </section>
      </aside>
    </div>
  );
}
