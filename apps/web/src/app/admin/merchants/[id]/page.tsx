'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date, FULFILMENT_LABEL, MERCHANT_TYPE_LABEL, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Detail {
  id: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  type: string;
  status: string;
  riskTier: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
  cacNumber: string | null;
  publicAreaLabel: string | null;
  settlementMode: string;
  providerSubaccountCode: string | null;
  payout: { bankCode: string; accountNumberMasked: string; accountName: string } | null;
  members: { role: string; user: { name: string; email: string; phone: string | null } }[];
  locations: { id: string; kind: string; label: string; publicAddress: string | null; privateAddress: string | null; area: { name: string }; unitLabel: string | null }[];
  serviceAreas: { area: { name: string }; deliveryFeeMinor: number }[];
  fulfilmentOpts: { method: string; enabled: boolean; collectionPoint: { name: string } | null }[];
  affiliations: { id: string; status: string; unitLabel: string | null; market: { name: string } }[];
  verifications: { id: string; pathway: string; status: string; submittedAt: string; decidedAt: string | null; decisionNotes: string | null; requestNote: string | null; expiresAt: string | null; documents: { id: string; type: string; originalName: string; sizeBytes: number; createdAt: string }[] }[];
  requiredDocuments: { type: string; label: string; provided: boolean }[];
  _count: { listings: number; orders: number };
}

export default function AdminMerchant() {
  const { id } = useParams<{ id: string }>();
  const { data: m, reload, loading, error } = useApi<Detail>(`/admin/merchants/${id}`);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [sub, setSub] = useState('');
  if (loading) return <Loading />;
  if (error || !m) return <Alert tone="error">{error?.message}</Alert>;
  const decide = async (decision: string, extra: object = {}) => {
    try {
      await api(`/admin/merchants/${id}/${decision}`, { body: { note, ...extra } });
      setMsg({ tone: 'success', text: `Done: ${decision}` });
      setNote('');
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    }
  };
  const v = m.verifications[0];
  return (
    <div className="grid-main-side">
      <div className="stack">
        <div className="row-between">
          <h2 className="mb-0">
            {m.displayName} <StatusBadge status={m.status} />
          </h2>
          {m.status === 'APPROVED' && <Link href={`/s/${m.slug}`}>Storefront</Link>}
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <section className="card">
          <dl className="kv">
            <dt>Type</dt>
            <dd>
              {MERCHANT_TYPE_LABEL[m.type]} · risk tier {m.riskTier.toLowerCase()}
            </dd>
            <dt>Legal name / CAC</dt>
            <dd>
              {m.legalName ?? '—'} / {m.cacNumber ?? '—'}
            </dd>
            <dt>Contact</dt>
            <dd>
              {m.contactEmail} · {m.contactPhone}
            </dd>
            <dt>Public area</dt>
            <dd>{m.publicAreaLabel}</dd>
            <dt>Payout</dt>
            <dd>{m.payout ? `${m.payout.accountName} · ${m.payout.accountNumberMasked} · bank ${m.payout.bankCode}` : 'Not set'}</dd>
            <dt>Settlement</dt>
            <dd>
              {m.settlementMode.replace('_', ' ').toLowerCase()} {m.providerSubaccountCode && `(${m.providerSubaccountCode})`}
            </dd>
            <dt>Team</dt>
            <dd>{m.members.map((x) => `${x.user.name} <${x.user.email}> (${x.role.toLowerCase()})`).join(', ')}</dd>
            <dt>Activity</dt>
            <dd>
              {m._count.listings} listings · {m._count.orders} orders
            </dd>
          </dl>
          <p className="small" style={{ marginTop: 12 }}>
            {m.description}
          </p>
        </section>
        <section className="card stack-sm">
          <h3>Locations &amp; fulfilment</h3>
          <p className="meta mb-0">Private addresses are shown to staff for verification only; your access is audited.</p>
          {m.locations.map((l) => (
            <div key={l.id} className="small">
              <strong>{l.label}</strong> ({l.kind === 'PRIVATE_FULFILMENT' ? 'private' : 'public'}) — {l.publicAddress ?? l.privateAddress}, {l.area.name} {l.unitLabel && `· unit ${l.unitLabel}`}
            </div>
          ))}
          <div className="small">Methods: {m.fulfilmentOpts.filter((o) => o.enabled).map((o) => `${FULFILMENT_LABEL[o.method]}${o.collectionPoint ? ` (${o.collectionPoint.name})` : ''}`).join(', ') || '—'}</div>
          {m.serviceAreas.length > 0 && <div className="small">Delivers to: {m.serviceAreas.map((s) => `${s.area.name} ${naira(s.deliveryFeeMinor)}`).join(', ')}</div>}
          {m.affiliations.map((a) => (
            <div key={a.id} className="small">
              Market: {a.market.name} {a.unitLabel && `(${a.unitLabel})`} <StatusBadge status={a.status} />
            </div>
          ))}
        </section>
        {v && (
          <section className="card stack-sm">
            <h3>
              Verification — {v.pathway.replace(/_/g, ' ').toLowerCase()} <StatusBadge status={v.status} />
            </h3>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {m.requiredDocuments.map((d) => (
                <li key={d.type}>
                  {d.provided ? '✅' : '❌'} {d.label}
                </li>
              ))}
            </ul>
            {v.documents.map((d) => (
              <div key={d.id} className="small">
                <a href={`/api/admin/verification-documents/${d.id}`} target="_blank" rel="noopener noreferrer">
                  {d.type.replace(/_/g, ' ').toLowerCase()} — {d.originalName}
                </a>{' '}
                <span className="meta">
                  {(d.sizeBytes / 1024).toFixed(0)} KB · {date(d.createdAt)}
                </span>
              </div>
            ))}
            {v.requestNote && <Alert tone="warn">Requested: {v.requestNote}</Alert>}
            {v.decisionNotes && <p className="small mb-0">Decision notes: {v.decisionNotes}</p>}
            {v.expiresAt && <p className="small mb-0">Valid until {date(v.expiresAt)}</p>}
          </section>
        )}
      </div>
      <aside className="card stack-sm">
        <h3>Decision</h3>
        <label htmlFor="note">Note / reason (recorded in audit log; shared with merchant for rejections &amp; requests)</label>
        <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
        {m.status === 'PENDING_REVIEW' && (
          <>
            <button className="btn btn-block" onClick={() => decide('approve')}>
              Approve merchant
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => decide('request-info')}>
              Request more information
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => decide('request-info', { riskTier: 'ENHANCED' })}>
              Require enhanced verification
            </button>
            <button className="btn btn-danger btn-block" onClick={() => decide('reject')}>
              Reject
            </button>
          </>
        )}
        {m.status === 'APPROVED' && (
          <button className="btn btn-danger btn-block" onClick={() => decide('suspend')}>
            Suspend merchant
          </button>
        )}
        {m.status === 'SUSPENDED' && (
          <button className="btn btn-block" onClick={() => decide('reinstate')}>
            Reinstate merchant
          </button>
        )}
        <button className="btn btn-secondary btn-block" onClick={() => decide('risk-tier', { riskTier: m.riskTier === 'ENHANCED' ? 'STANDARD' : 'ENHANCED' })}>
          Set risk tier: {m.riskTier === 'ENHANCED' ? 'standard' : 'enhanced'}
        </button>
        <hr />
        <h3>Settlement (finance)</h3>
        <input aria-label="Provider subaccount code" type="text" placeholder="Provider subaccount code (ACCT_…)" value={sub} onChange={(e) => setSub(e.target.value)} />
        <div className="row">
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              try {
                await api(`/admin/merchants/${id}/settlement-mode`, { body: { mode: 'PROVIDER_SPLIT', providerSubaccountCode: sub } });
                await reload();
              } catch (e) {
                setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
              }
            }}
          >
            Use provider split
          </button>
          <button className="btn btn-link" onClick={async () => (await api(`/admin/merchants/${id}/settlement-mode`, { body: { mode: 'MANUAL_RECORD', providerSubaccountCode: null } }).catch(() => undefined), reload())}>
            Manual payouts
          </button>
        </div>
      </aside>
    </div>
  );
}
