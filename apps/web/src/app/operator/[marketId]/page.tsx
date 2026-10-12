'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Loading, Stat, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date, MERCHANT_TYPE_LABEL, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Overview {
  market: {
    id: string;
    slug: string;
    name: string;
    tagline: string;
    description: string;
    publicAddress: string;
    openingHours: string;
  };
  role: string;
  metrics: {
    approvedMerchants: number;
    pendingAffiliations: number;
    activeListings: number;
    paidOrders: number;
    gmvMinor: number;
    transactingMerchants: number;
  };
}
interface Affiliation {
  id: string;
  status: string;
  unitLabel: string | null;
  createdAt: string;
  decisionNote: string | null;
  merchant: {
    id: string;
    slug: string;
    displayName: string;
    type: string;
    status: string;
    activeListings: number;
  };
}
interface Announcement {
  id: string;
  title: string;
  body: string;
  published: boolean;
  startsAt: string;
  endsAt: string | null;
}
interface CP {
  id: string;
  name: string;
  publicAddress: string;
  openingHours: string;
  instructions: string;
  active: boolean;
}

export default function OperatorPortal() {
  const { marketId } = useParams<{ marketId: string }>();
  const base = `/operator/${marketId}`;
  const ov = useApi<Overview>(base);
  const merchants = useApi<Affiliation[]>(`${base}/merchants`);
  const ann = useApi<Announcement[]>(`${base}/announcements`);
  const cps = useApi<CP[]>(`${base}/collection-points`);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [profile, setProfile] = useState({
    tagline: '',
    description: '',
    openingHours: '',
    publicAddress: '',
  });
  const [newAnn, setNewAnn] = useState({ title: '', body: '' });
  const [newCp, setNewCp] = useState({
    name: '',
    publicAddress: '',
    openingHours: '',
    instructions: '',
  });

  useEffect(() => {
    if (ov.data)
      setProfile({
        tagline: ov.data.market.tagline,
        description: ov.data.market.description,
        openingHours: ov.data.market.openingHours,
        publicAddress: ov.data.market.publicAddress,
      });
  }, [ov.data]);

  const run = async (fn: () => Promise<unknown>, ok: string, reload?: () => Promise<void>) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      if (reload) await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    }
  };

  if (ov.loading) return <Loading />;
  if (ov.error || !ov.data)
    return (
      <Alert tone="error">
        {ov.error?.status === 401
          ? 'Sign in to access the market portal.'
          : 'Market not found or no access.'}
      </Alert>
    );
  const { market, metrics, role } = ov.data;
  const isAdmin = role === 'MARKET_ADMIN';
  return (
    <div className="stack">
      <div className="row-between">
        <h1 className="mb-0">{market.name} — market portal</h1>
        <Link href={`/markets/${market.slug}`}>View public page</Link>
      </div>
      <p className="meta">
        You can manage this market&apos;s page, participating stores and collection points. Customer
        identities, merchant payouts and individual store finances are not visible here.
      </p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="stat-grid">
        <Stat
          label="Participating stores"
          value={metrics.approvedMerchants}
          note={`${metrics.pendingAffiliations} pending requests`}
        />
        <Stat label="Active products" value={metrics.activeListings} />
        <Stat
          label="Paid orders (30 days)"
          value={metrics.paidOrders}
          note={`${metrics.transactingMerchants} stores selling`}
        />
        <Stat
          label="Sales value (30 days)"
          value={naira(metrics.gmvMinor)}
          note="Aggregate, goods only"
        />
      </div>

      <section className="card stack-sm">
        <h2>Stores &amp; affiliation requests</h2>
        {merchants.data?.map((a) => (
          <div key={a.id} className="row-between card-flat small">
            <span>
              <strong>{a.merchant.displayName}</strong> {a.unitLabel && `· unit ${a.unitLabel}`} ·{' '}
              {MERCHANT_TYPE_LABEL[a.merchant.type]} · {a.merchant.activeListings} products
              <div className="meta">
                Requested {date(a.createdAt)}{' '}
                {a.merchant.status !== 'APPROVED' &&
                  `· KDCN verification: ${a.merchant.status.toLowerCase().replace('_', ' ')}`}
              </div>
            </span>
            <span className="row">
              <StatusBadge status={a.status} />
              {isAdmin && a.status === 'PENDING' && (
                <>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      run(
                        () =>
                          api(`${base}/affiliations/${a.id}/approve`, {
                            body: { note: 'Confirmed by market management' },
                          }),
                        'Store approved',
                        merchants.reload,
                      )
                    }
                  >
                    Confirm store
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() =>
                      run(
                        () =>
                          api(`${base}/affiliations/${a.id}/reject`, {
                            body: { note: 'Not a tenant of this market' },
                          }),
                        'Request rejected',
                        merchants.reload,
                      )
                    }
                  >
                    Reject
                  </button>
                </>
              )}
              {isAdmin && a.status === 'APPROVED' && (
                <button
                  className="btn btn-sm btn-link"
                  onClick={() =>
                    confirm('Remove this store from the market?') &&
                    run(
                      () =>
                        api(`${base}/affiliations/${a.id}/end`, {
                          body: { note: 'Tenancy ended' },
                        }),
                      'Store removed from market',
                      merchants.reload,
                    )
                  }
                >
                  End
                </button>
              )}
            </span>
          </div>
        ))}
        {merchants.data?.length === 0 && <p className="muted small">No stores yet.</p>}
      </section>

      <div className="grid-2">
        <form
          className="card"
          onSubmit={(e) => (
            e.preventDefault(),
            run(
              () => api(base, { method: 'PATCH', body: profile }),
              'Market page updated',
              ov.reload,
            )
          )}
        >
          <h2>Market page</h2>
          <div className="field">
            <label htmlFor="tg">Tagline</label>
            <input
              id="tg"
              type="text"
              maxLength={140}
              value={profile.tagline}
              onChange={(e) => setProfile({ ...profile, tagline: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ds">Description</label>
            <textarea
              id="ds"
              value={profile.description}
              onChange={(e) => setProfile({ ...profile, description: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="oh">Opening hours</label>
            <input
              id="oh"
              type="text"
              value={profile.openingHours}
              onChange={(e) => setProfile({ ...profile, openingHours: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="pa">Public address</label>
            <input
              id="pa"
              type="text"
              value={profile.publicAddress}
              onChange={(e) => setProfile({ ...profile, publicAddress: e.target.value })}
            />
          </div>
          <div className="row">
            <button className="btn">Save</button>
            <label className="btn btn-secondary btn-sm">
              Upload cover image
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.set('file', file);
                  void run(
                    () => api(`${base}/images/cover`, { method: 'POST', form: fd }),
                    'Cover updated',
                  );
                }}
              />
            </label>
          </div>
        </form>
        <section className="card stack-sm">
          <h2>Announcements &amp; promotions</h2>
          {ann.data?.map((a) => (
            <div key={a.id} className="card-flat small">
              <div className="row-between">
                <strong>{a.title}</strong>
                <span className="row">
                  <button
                    className="btn btn-link"
                    onClick={() =>
                      run(
                        () =>
                          api(`${base}/announcements/${a.id}`, {
                            method: 'PATCH',
                            body: { published: !a.published },
                          }),
                        'Updated',
                        ann.reload,
                      )
                    }
                  >
                    {a.published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    className="btn btn-link"
                    onClick={() =>
                      run(
                        () => api(`${base}/announcements/${a.id}`, { method: 'DELETE' }),
                        'Deleted',
                        ann.reload,
                      )
                    }
                  >
                    Delete
                  </button>
                </span>
              </div>
              <div>{a.body}</div>
            </div>
          ))}
          <form
            className="stack-sm"
            onSubmit={(e) => (
              e.preventDefault(),
              run(
                () =>
                  api(`${base}/announcements`, { body: newAnn }).then(() =>
                    setNewAnn({ title: '', body: '' }),
                  ),
                'Announcement published',
                ann.reload,
              )
            )}
          >
            <input
              aria-label="Title"
              type="text"
              required
              minLength={3}
              placeholder="Title (e.g. Weekend sale)"
              value={newAnn.title}
              onChange={(e) => setNewAnn({ ...newAnn, title: e.target.value })}
            />
            <textarea
              aria-label="Message"
              required
              minLength={3}
              placeholder="Message"
              value={newAnn.body}
              onChange={(e) => setNewAnn({ ...newAnn, body: e.target.value })}
            />
            <button className="btn btn-sm btn-secondary">Publish announcement</button>
          </form>
        </section>
      </div>

      <section className="card stack-sm">
        <h2>Shared collection points</h2>
        {cps.data?.map((c) => (
          <div key={c.id} className="row-between card-flat small">
            <span>
              <strong>{c.name}</strong> — {c.publicAddress}{' '}
              {c.openingHours && `· ${c.openingHours}`}
              {c.instructions && <div className="meta">{c.instructions}</div>}
            </span>
            {isAdmin && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  run(
                    () =>
                      api(`${base}/collection-points/${c.id}`, {
                        method: 'PATCH',
                        body: { active: !c.active },
                      }),
                    'Updated',
                    cps.reload,
                  )
                }
              >
                {c.active ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </div>
        ))}
        {isAdmin && (
          <form
            className="grid-2"
            onSubmit={(e) => (
              e.preventDefault(),
              run(
                () =>
                  api(`${base}/collection-points`, { body: newCp }).then(() =>
                    setNewCp({ name: '', publicAddress: '', openingHours: '', instructions: '' }),
                  ),
                'Collection point added',
                cps.reload,
              )
            )}
          >
            <input
              aria-label="Name"
              type="text"
              required
              minLength={3}
              placeholder="Name (e.g. Level 1 concierge)"
              value={newCp.name}
              onChange={(e) => setNewCp({ ...newCp, name: e.target.value })}
            />
            <input
              aria-label="Address"
              type="text"
              required
              minLength={5}
              placeholder="Location within the market"
              value={newCp.publicAddress}
              onChange={(e) => setNewCp({ ...newCp, publicAddress: e.target.value })}
            />
            <input
              aria-label="Opening hours"
              type="text"
              placeholder="Opening hours"
              value={newCp.openingHours}
              onChange={(e) => setNewCp({ ...newCp, openingHours: e.target.value })}
            />
            <input
              aria-label="Instructions"
              type="text"
              placeholder="Collection instructions"
              value={newCp.instructions}
              onChange={(e) => setNewCp({ ...newCp, instructions: e.target.value })}
            />
            <div>
              <button className="btn btn-sm btn-secondary">Add collection point</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
