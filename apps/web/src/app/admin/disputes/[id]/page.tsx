'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Dispute {
  id: string;
  status: string;
  reason: string;
  description: string;
  resolution: string | null;
  priorOrderStatus: string;
  createdAt: string;
  order: { id: string; number: string; status: string; totalMinor: number };
  messages: { id: string; authorRole: string; body: string; createdAt: string }[];
}

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const { data: d, reload, loading, error } = useApi<Dispute>(`/admin/disputes/${id}`);
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState('NO_REFUND');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (loading) return <Loading />;
  if (error || !d) return <Alert tone="error">{error?.message}</Alert>;
  const open = ['OPEN', 'AWAITING_MERCHANT', 'UNDER_REVIEW'].includes(d.status);
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
          Dispute on <Link href={`/admin/orders/${d.order.id}`}>{d.order.number}</Link>{' '}
          <StatusBadge status={d.status} />
        </h2>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <p className="small">
          Reason: <strong>{d.reason.replace(/_/g, ' ')}</strong> · order total{' '}
          {naira(d.order.totalMinor)} · status before dispute:{' '}
          {d.priorOrderStatus.toLowerCase().replace(/_/g, ' ')}
        </p>
        {d.messages.map((m) => (
          <div key={m.id} className="card-flat small">
            <strong>{m.authorRole}</strong> <span className="meta">{date(m.createdAt, true)}</span>
            <div style={{ whiteSpace: 'pre-line' }}>{m.body}</div>
          </div>
        ))}
        {open && (
          <form
            className="stack-sm"
            onSubmit={(e) => (
              e.preventDefault(),
              run(
                () =>
                  api(`/admin/disputes/${id}/messages`, { body: { body: text } }).then(() =>
                    setText(''),
                  ),
                'Message sent',
              )
            )}
          >
            <label htmlFor="m">Message to both parties</label>
            <textarea id="m" required value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-secondary btn-sm">Send</button>
          </form>
        )}
        {d.resolution && <Alert tone="success">Resolution: {d.resolution}</Alert>}
      </div>
      {open && (
        <aside className="card stack-sm">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() =>
              run(() => api(`/admin/disputes/${id}/assign`, { method: 'POST' }), 'Assigned to you')
            }
          >
            Assign to me
          </button>
          <h3>Resolve</h3>
          <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="NO_REFUND">No refund — complete the order</option>
            <option value="REFUND_PARTIAL">Partial refund</option>
            <option value="REFUND_FULL">Full refund</option>
          </select>
          {outcome === 'REFUND_PARTIAL' && (
            <input
              aria-label="Amount ₦"
              type="number"
              min={1}
              placeholder="Amount ₦"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
          <label htmlFor="n">Resolution note (sent to customer, audited)</label>
          <textarea id="n" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-block"
            disabled={note.length < 5}
            onClick={() =>
              run(
                () =>
                  api(`/admin/disputes/${id}/resolve`, {
                    body: {
                      outcome,
                      note,
                      ...(outcome === 'REFUND_PARTIAL'
                        ? { amountMinor: Math.round(Number(amount) * 100) }
                        : {}),
                    },
                  }),
                'Dispute resolved',
              )
            }
          >
            Resolve dispute
          </button>
          <p className="meta mb-0">
            Refunds follow the order&apos;s terms and applicable consumer-protection obligations.
            Refunds go to the original payment method.
          </p>
        </aside>
      )}
    </div>
  );
}
