'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMerchant } from '@/components/MerchantContext';
import { Timeline } from '@/components/OrderView';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date, FULFILMENT_LABEL, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface MerchantOrder {
  id: string;
  number: string;
  status: string;
  statusLabel: string;
  items: { id: string; title: string; variantName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; stockMode: string; leadTimeDays: number }[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  fulfilmentMethod: string;
  customerNote: string | null;
  confirmationDeadline: string | null;
  createdAt: string;
  cancellationReason: string | null;
  customer: { name: string; phone: string | null };
  fulfilment: { method: string; status: string; collectionPoint: { name: string; address: string } | null; deliveryAddress: string | null; failedAttempts: number; pickupFromMerchant: boolean; assignments: { partner: string; rider: string | null; riderPhone: string | null; status: string; at: string }[] } | null;
  settlement: { status: string; commissionMinor: number; merchantNetMinor: number; refundedMinor: number; mode: string; payoutReference: string | null } | null;
  dispute: { id: string; status: string; reason: string; description: string; messages: { id: string; authorRole: string; body: string; createdAt: string }[] } | null;
  timeline: { label: string; note: string | null; at: string }[];
  payments: { testMode: boolean; status: string }[];
  actions: Record<string, boolean>;
}

export default function MerchantOrderPage() {
  const { m } = useMerchant();
  const { orderId } = useParams<{ orderId: string }>();
  const base = `/merchant/${m.id}/orders/${orderId}`;
  const { data: o, setData, loading, error } = useApi<MerchantOrder>(base);
  const [form, setForm] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [dispatch, setDispatch] = useState({ partnerName: '', riderName: '', riderPhone: '' });
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error || !o) return <Alert tone="error">{error?.message ?? 'Not found'}</Alert>;

  const act = async (action: string, body?: unknown, ok = 'Updated') => {
    setBusy(true);
    setMsg(null);
    try {
      setData(await api<MerchantOrder>(`${base}/${action}`, { body: body ?? {} }));
      setMsg({ tone: 'success', text: ok });
      setForm(null);
      setText('');
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  };
  const a = o.actions;
  return (
    <div className="grid-main-side">
      <div className="stack">
        <div className="row-between">
          <h2 className="mb-0">Order {o.number}</h2>
          <div className="row">
            {o.payments.some((p) => p.testMode) && <span className="badge badge-test">TEST PAYMENT</span>}
            <StatusBadge status={o.status} label={o.statusLabel} />
          </div>
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {o.cancellationReason && <Alert tone="warn">{o.cancellationReason}</Alert>}
        <section className="card stack-sm">
          <h3>Items</h3>
          {o.items.map((i) => (
            <div key={i.id} className="summary-line small">
              <span>
                {i.quantity} × {i.title} ({i.variantName}) {i.stockMode === 'MADE_TO_ORDER' && <span className="badge badge-amber">Made to order · {i.leadTimeDays}d</span>}
              </span>
              <span>{naira(i.lineTotalMinor)}</span>
            </div>
          ))}
          <div className="summary-line">
            <span>Goods total</span>
            <strong>{naira(o.subtotalMinor)}</strong>
          </div>
          {o.customerNote && <Alert tone="info">Customer note: {o.customerNote}</Alert>}
        </section>
        <section className="card stack-sm">
          <h3>{FULFILMENT_LABEL[o.fulfilmentMethod]}</h3>
          <dl className="kv">
            <dt>Customer</dt>
            <dd>{o.customer.name}</dd>
            <dt>Phone</dt>
            <dd>{o.customer.phone ?? <span className="muted">Shown after payment</span>}</dd>
            {o.fulfilment?.collectionPoint && (
              <>
                <dt>Pickup point</dt>
                <dd>
                  {o.fulfilment.collectionPoint.name} — {o.fulfilment.collectionPoint.address}
                </dd>
              </>
            )}
            {(o.fulfilmentMethod === 'MERCHANT_DELIVERY' || o.fulfilmentMethod === 'THIRD_PARTY_DELIVERY') && (
              <>
                <dt>Deliver to</dt>
                <dd>{o.fulfilment?.deliveryAddress ?? <span className="muted">Shown after payment</span>}</dd>
              </>
            )}
            {o.fulfilment && o.fulfilment.failedAttempts > 0 && (
              <>
                <dt>Failed attempts</dt>
                <dd>{o.fulfilment.failedAttempts}</dd>
              </>
            )}
          </dl>
          {o.fulfilment?.assignments.map((x, i) => (
            <div key={i} className="meta">
              {x.partner} {x.rider && `· ${x.rider}`} {x.riderPhone && `(${x.riderPhone})`} — {x.status.toLowerCase()} {date(x.at, true)}
            </div>
          ))}
          {o.fulfilmentMethod === 'THIRD_PARTY_DELIVERY' && <p className="meta mb-0">KDCN operations will arrange a courier{o.fulfilment?.pickupFromMerchant ? ' to collect from you' : ''}. You can also record the dispatch yourself.</p>}
        </section>
        {o.dispute && (
          <section className="card stack-sm">
            <h3>
              Dispute: {o.dispute.reason.replace(/_/g, ' ')} <StatusBadge status={o.dispute.status} />
            </h3>
            {o.dispute.messages.map((mm) => (
              <div key={mm.id} className="card-flat small">
                <strong>{mm.authorRole}</strong> <span className="meta">{date(mm.createdAt, true)}</span>
                <div style={{ whiteSpace: 'pre-line' }}>{mm.body}</div>
              </div>
            ))}
            {['OPEN', 'AWAITING_MERCHANT', 'UNDER_REVIEW'].includes(o.dispute.status) && (
              <form
                className="stack-sm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setData(await api(`/merchant/${m.id}/disputes/${o.dispute!.id}/messages`, { body: { body: text } }));
                  setText('');
                }}
              >
                <label htmlFor="dmsg">Your response</label>
                <textarea id="dmsg" required value={text} onChange={(e) => setText(e.target.value)} />
                <button className="btn btn-secondary btn-sm">Send to KDCN &amp; customer</button>
              </form>
            )}
          </section>
        )}
      </div>
      <aside className="stack">
        <section className="card stack-sm">
          <h3>Next step</h3>
          {a.canConfirm && (
            <>
              <p className="small mb-0">Check you have every item, then confirm so the customer can pay{o.confirmationDeadline ? ` (by ${date(o.confirmationDeadline, true)})` : ''}.</p>
              <button className="btn btn-block" disabled={busy} onClick={() => act('confirm', { note: text || undefined }, 'Confirmed — customer asked to pay')}>
                Confirm availability
              </button>
            </>
          )}
          {a.canReject && form !== 'reject' && (
            <button className="btn btn-secondary btn-block" onClick={() => setForm('reject')}>
              I can&apos;t fulfil this
            </button>
          )}
          {form === 'reject' && (
            <form className="stack-sm" onSubmit={(e) => (e.preventDefault(), act('reject', { reason: text }, 'Order declined'))}>
              <label htmlFor="rr">Reason (shown to customer)</label>
              <input id="rr" type="text" required minLength={3} value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn btn-danger btn-sm" disabled={busy}>
                Decline order
              </button>
            </form>
          )}
          {a.canAccept && (
            <button className="btn btn-block" disabled={busy} onClick={() => act('accept', undefined, 'Order accepted')}>
              Accept paid order
            </button>
          )}
          {a.canStartPreparing && (
            <button className="btn btn-block" disabled={busy} onClick={() => act('preparing', undefined, 'Marked as preparing')}>
              Start preparing
            </button>
          )}
          {a.canMarkReady && (
            <button className="btn btn-block" disabled={busy} onClick={() => act('ready', undefined, 'Customer notified that the order is ready')}>
              Ready for collection
            </button>
          )}
          {a.canDispatch && (
            <form className="stack-sm" onSubmit={(e) => (e.preventDefault(), act('dispatch', { partnerName: dispatch.partnerName, riderName: dispatch.riderName || undefined, riderPhone: dispatch.riderPhone || undefined }, 'Dispatched'))}>
              <label htmlFor="pn">Delivered by</label>
              <input id="pn" type="text" required placeholder="Own rider / courier name" value={dispatch.partnerName} onChange={(e) => setDispatch({ ...dispatch, partnerName: e.target.value })} />
              <input aria-label="Rider name" type="text" placeholder="Rider name (optional)" value={dispatch.riderName} onChange={(e) => setDispatch({ ...dispatch, riderName: e.target.value })} />
              <input aria-label="Rider phone" type="tel" placeholder="Rider phone (optional)" value={dispatch.riderPhone} onChange={(e) => setDispatch({ ...dispatch, riderPhone: e.target.value })} />
              <button className="btn btn-block" disabled={busy}>
                Mark dispatched
              </button>
            </form>
          )}
          {a.canMarkDelivered && (
            <button className="btn btn-block" disabled={busy} onClick={() => act('delivered', {}, 'Marked delivered')}>
              Mark delivered
            </button>
          )}
          {a.canReportFailedDelivery && form !== 'failed' && (
            <button className="btn btn-secondary btn-block" onClick={() => setForm('failed')}>
              Delivery failed
            </button>
          )}
          {form === 'failed' && (
            <form className="stack-sm" onSubmit={(e) => (e.preventDefault(), act('delivery-failed', { note: text }, 'Failed attempt recorded'))}>
              <label htmlFor="fn">What happened?</label>
              <input id="fn" type="text" required minLength={3} value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn btn-secondary btn-sm" disabled={busy}>
                Record failed attempt
              </button>
            </form>
          )}
          {a.canVerifyCollection && (
            <form className="stack-sm" onSubmit={(e) => (e.preventDefault(), act('collected', { code: text }, 'Collection confirmed'))}>
              <label htmlFor="cc">Customer&apos;s 6-digit collection code</label>
              <input id="cc" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn btn-block" disabled={busy}>
                Confirm handover
              </button>
            </form>
          )}
          {a.canCancel && m.myRole !== 'STAFF' && form !== 'cancel' && (
            <button className="btn btn-link" style={{ color: 'var(--red-700)' }} onClick={() => setForm('cancel')}>
              Cancel &amp; refund customer
            </button>
          )}
          {form === 'cancel' && (
            <form className="stack-sm" onSubmit={(e) => (e.preventDefault(), act('cancel', { reason: text }, 'Cancelled — full refund started'))}>
              <label htmlFor="cr">Reason</label>
              <input id="cr" type="text" required minLength={3} value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn btn-danger btn-sm" disabled={busy}>
                Cancel with full refund
              </button>
            </form>
          )}
          {!Object.values(a).some(Boolean) && <p className="small muted mb-0">No action needed.</p>}
        </section>
        {o.settlement && (
          <section className="card stack-sm small">
            <h3>Your earnings</h3>
            <div className="summary-line">
              <span>Goods</span>
              <span>{naira(o.subtotalMinor)}</span>
            </div>
            <div className="summary-line">
              <span>KDCN commission</span>
              <span>−{naira(o.settlement.commissionMinor)}</span>
            </div>
            {o.settlement.refundedMinor > 0 && (
              <div className="summary-line">
                <span>Refunds</span>
                <span>−{naira(o.settlement.refundedMinor)}</span>
              </div>
            )}
            <div className="summary-line summary-total">
              <span>You receive</span>
              <span>{naira(o.settlement.merchantNetMinor)}</span>
            </div>
            <div>
              <StatusBadge status={o.settlement.status} /> {o.settlement.payoutReference && <span className="meta">Ref {o.settlement.payoutReference}</span>}
            </div>
          </section>
        )}
        <section className="card">
          <h3>History</h3>
          <Timeline events={o.timeline} />
        </section>
      </aside>
    </div>
  );
}
