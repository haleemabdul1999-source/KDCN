'use client';

import { useState } from 'react';
import { Alert, Loading, Stars } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Product {
  id: string;
  title: string;
  description: string;
  moderationNote: string | null;
  category: { name: string };
  createdBy: { id: string; displayName: string; type: string; riskTier: string };
  images: { url: string }[];
  listings: { id: string; slug: string; status: string }[];
}
interface Affiliation {
  id: string;
  unitLabel: string | null;
  createdAt: string;
  market: { name: string };
  merchant: { displayName: string; status: string };
}
interface Report {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string;
  createdAt: string;
}
interface Review {
  id: string;
  rating: number;
  body: string;
  status: string;
  merchant: { displayName: string };
  order: { number: string };
}

export default function Moderation() {
  const products = useApi<{ items: Product[] }>('/admin/moderation/products');
  const affiliations = useApi<Affiliation[]>('/admin/affiliations');
  const reports = useApi<Report[]>('/admin/reports');
  const reviews = useApi<Review[]>('/admin/reviews');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, reload: () => Promise<void>) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: 'Saved' });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    }
  };
  return (
    <div className="stack">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <section className="card stack-sm">
        <h2>Products awaiting review</h2>
        {products.loading && <Loading />}
        {products.data?.items.length === 0 && <p className="muted small">Queue is empty.</p>}
        {products.data?.items.map((p) => (
          <div key={p.id} className="card-flat stack-sm">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              {p.images[0] && (
                <img
                  src={p.images[0].url}
                  alt=""
                  width={64}
                  height={64}
                  style={{ borderRadius: 8, objectFit: 'cover' }}
                />
              )}
              <div style={{ flex: 1 }}>
                <strong>{p.title}</strong> <span className="meta">· {p.category.name}</span>
                <div className="meta">
                  {p.createdBy.displayName} ({p.createdBy.type.toLowerCase().replace('_', ' ')},{' '}
                  {p.createdBy.riskTier.toLowerCase()} tier)
                </div>
                <div className="small">{p.description.slice(0, 300)}</div>
              </div>
            </div>
            <div className="row">
              <input
                aria-label="Note"
                type="text"
                placeholder="Note"
                value={notes[p.id] ?? ''}
                onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-sm"
                onClick={() =>
                  run(
                    () =>
                      api(`/admin/moderation/products/${p.id}`, {
                        body: { decision: 'APPROVED', note: notes[p.id] ?? '' },
                      }),
                    products.reload,
                  )
                }
              >
                Approve
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() =>
                  run(
                    () =>
                      api(`/admin/moderation/products/${p.id}`, {
                        body: { decision: 'REJECTED', note: notes[p.id] ?? 'Not permitted' },
                      }),
                    products.reload,
                  )
                }
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="card stack-sm">
        <h2>Market affiliation requests</h2>
        {affiliations.data?.length === 0 && <p className="muted small">None pending.</p>}
        {affiliations.data?.map((a) => (
          <div key={a.id} className="row-between card-flat small">
            <span>
              <strong>{a.merchant.displayName}</strong> → {a.market.name}{' '}
              {a.unitLabel && `(unit ${a.unitLabel})`}{' '}
              <span className="meta">{date(a.createdAt)}</span>
            </span>
            <span className="row">
              <button
                className="btn btn-sm"
                onClick={() =>
                  run(
                    () => api(`/admin/affiliations/${a.id}/approve`, { body: {} }),
                    affiliations.reload,
                  )
                }
              >
                Approve
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  run(
                    () =>
                      api(`/admin/affiliations/${a.id}/reject`, {
                        body: { note: 'Could not verify tenancy' },
                      }),
                    affiliations.reload,
                  )
                }
              >
                Reject
              </button>
            </span>
          </div>
        ))}
      </section>
      <section className="card stack-sm">
        <h2>Reports</h2>
        {reports.data?.length === 0 && <p className="muted small">No open reports.</p>}
        {reports.data?.map((r) => (
          <div key={r.id} className="card-flat small stack-sm">
            <div>
              <strong>{r.targetType.toLowerCase()}</strong> {r.targetId.slice(0, 8)}… —{' '}
              {r.reason.replace('_', ' ')} <span className="meta">{date(r.createdAt)}</span>
            </div>
            {r.details && <div>{r.details}</div>}
            <div className="row">
              <input
                aria-label="Resolution"
                type="text"
                placeholder="Resolution"
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                style={{ flex: 1 }}
              />
              {r.targetType === 'LISTING' && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() =>
                    run(async () => {
                      await api(`/admin/listings/${r.targetId}/block`, {
                        body: { reason: notes[r.id] || r.reason },
                      });
                      await api(`/admin/reports/${r.id}`, {
                        body: { status: 'ACTIONED', resolution: notes[r.id] || 'Listing blocked' },
                      });
                    }, reports.reload)
                  }
                >
                  Block listing
                </button>
              )}
              <button
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  run(
                    () =>
                      api(`/admin/reports/${r.id}`, {
                        body: { status: 'ACTIONED', resolution: notes[r.id] || 'Actioned' },
                      }),
                    reports.reload,
                  )
                }
              >
                Mark actioned
              </button>
              <button
                className="btn btn-sm btn-link"
                onClick={() =>
                  run(
                    () =>
                      api(`/admin/reports/${r.id}`, {
                        body: { status: 'DISMISSED', resolution: notes[r.id] || 'No issue found' },
                      }),
                    reports.reload,
                  )
                }
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="card stack-sm">
        <h2>Flagged reviews</h2>
        <p className="meta mb-0">
          Reviews come from completed orders. Hide only content that breaks the review policy
          (abuse, personal data, spam) — not negative opinions.
        </p>
        {reviews.data?.length === 0 && <p className="muted small">None flagged.</p>}
        {reviews.data?.map((r) => (
          <div key={r.id} className="card-flat small stack-sm">
            <div>
              <Stars value={r.rating} /> {r.merchant.displayName} · order {r.order.number}
            </div>
            <div>{r.body}</div>
            <div className="row">
              <input
                aria-label="Reason"
                type="text"
                placeholder="Reason (audited)"
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-sm btn-danger"
                onClick={() =>
                  run(
                    () =>
                      api(`/admin/reviews/${r.id}/moderate`, {
                        body: { status: 'HIDDEN', reason: notes[r.id] || 'Policy violation' },
                      }),
                    reviews.reload,
                  )
                }
              >
                Hide
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  run(
                    () =>
                      api(`/admin/reviews/${r.id}/moderate`, {
                        body: { status: 'PUBLISHED', reason: notes[r.id] || 'Report not upheld' },
                      }),
                    reviews.reload,
                  )
                }
              >
                Keep published
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
