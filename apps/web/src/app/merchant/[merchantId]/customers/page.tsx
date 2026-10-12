'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMerchant } from '@/components/MerchantContext';
import { Stars, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Enquiry {
  id: string;
  message: string;
  reply: string | null;
  createdAt: string;
}
interface Review {
  id: string;
  rating: number;
  body: string;
  status: string;
  merchantResponse: string | null;
  createdAt: string;
  order: { number: string };
}
interface Dispute {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  resolution: string | null;
  order: { id: string; number: string };
}

export default function CustomersPage() {
  const { m } = useMerchant();
  const base = `/merchant/${m.id}`;
  const enquiries = useApi<Enquiry[]>(`${base}/enquiries`);
  const reviews = useApi<Review[]>(`${base}/reviews`);
  const disputes = useApi<Dispute[]>(`${base}/disputes`);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <div className="stack">
      <section className="card stack-sm">
        <h2>Disputes</h2>
        {disputes.data?.length === 0 && <p className="muted small">No disputes. 🎉</p>}
        {disputes.data?.map((d) => (
          <Link
            key={d.id}
            href={`${base}/orders/${d.order.id}`}
            className="card-flat row-between"
            style={{ color: 'inherit' }}
          >
            <span>
              Order {d.order.number} — {d.reason.replace(/_/g, ' ')}{' '}
              <span className="meta">{date(d.createdAt)}</span>
              {d.resolution && <div className="meta">Resolution: {d.resolution}</div>}
            </span>
            <StatusBadge status={d.status} />
          </Link>
        ))}
      </section>
      <section className="card stack-sm">
        <h2>Customer questions</h2>
        {enquiries.data?.length === 0 && <p className="muted small">No questions yet.</p>}
        {enquiries.data?.map((e) => (
          <div key={e.id} className="card-flat small stack-sm">
            <div>
              <strong>Q:</strong> {e.message} <span className="meta">{date(e.createdAt)}</span>
            </div>
            {e.reply ? (
              <div>
                <strong>A:</strong> {e.reply}
              </div>
            ) : (
              <form
                className="row"
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  await api(`${base}/enquiries/${e.id}/reply`, { body: { reply: drafts[e.id] } });
                  await enquiries.reload();
                }}
              >
                <input
                  aria-label="Reply"
                  type="text"
                  required
                  value={drafts[e.id] ?? ''}
                  onChange={(ev) => setDrafts({ ...drafts, [e.id]: ev.target.value })}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-sm">Reply</button>
              </form>
            )}
          </div>
        ))}
      </section>
      <section className="card stack-sm">
        <h2>Reviews</h2>
        <p className="meta mb-0">
          Reviews come only from customers who completed an order. You can respond once; reviews
          can&apos;t be edited or removed by sellers.
        </p>
        {reviews.data?.length === 0 && <p className="muted small">No reviews yet.</p>}
        {reviews.data?.map((r) => (
          <div key={r.id} className="card-flat small stack-sm">
            <div>
              <Stars value={r.rating} />{' '}
              <span className="meta">
                Order {r.order.number} · {date(r.createdAt)}
              </span>{' '}
              {r.status !== 'PUBLISHED' && <StatusBadge status={r.status} />}
            </div>
            {r.body && <div>{r.body}</div>}
            {r.merchantResponse ? (
              <div className="meta">Your response: {r.merchantResponse}</div>
            ) : (
              m.myRole !== 'STAFF' && (
                <form
                  className="row"
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    await api(`${base}/reviews/${r.id}/respond`, {
                      body: { response: drafts[r.id] },
                    });
                    await reviews.reload();
                  }}
                >
                  <input
                    aria-label="Response"
                    type="text"
                    required
                    minLength={2}
                    value={drafts[r.id] ?? ''}
                    onChange={(ev) => setDrafts({ ...drafts, [r.id]: ev.target.value })}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-sm btn-secondary">Respond</button>
                </form>
              )
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
