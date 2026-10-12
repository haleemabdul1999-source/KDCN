'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { date, MERCHANT_TYPE_LABEL } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Row {
  id: string;
  displayName: string;
  type: string;
  status: string;
  riskTier: string;
  publicAreaLabel: string | null;
  updatedAt: string;
  verifications: { pathway: string; status: string; submittedAt: string; expiresAt: string | null }[];
}

function MerchantsList() {
  const [status, setStatus] = useState(useSearchParams().get('status') ?? 'PENDING_REVIEW');
  const [q, setQ] = useState('');
  const { data, loading, error } = useApi<{ items: Row[]; total: number; counts: Record<string, number> }>(`/admin/merchants?pageSize=50${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <div className="stack">
      <div className="row">
        <div className="chip-row">
          {['PENDING_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'SUSPENDED', 'REJECTED', 'DRAFT', ''].map((s) => (
            <button key={s} className="chip" aria-current={status === s} onClick={() => setStatus(s)}>
              {s ? s.replace('_', ' ').toLowerCase() : 'all'} {s && data?.counts[s] ? `(${data.counts[s]})` : ''}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search merchants" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      {loading && <Loading />}
      {error && <Alert tone="error">{error.message}</Alert>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Type</th>
                <th>Status</th>
                <th>Verification</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/admin/merchants/${m.id}`}>{m.displayName}</Link>
                    <div className="meta">{m.publicAreaLabel}</div>
                  </td>
                  <td className="small">
                    {MERCHANT_TYPE_LABEL[m.type]}
                    {m.riskTier === 'ENHANCED' && <div className="badge badge-amber">Enhanced</div>}
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="small">{m.verifications[0] ? `${m.verifications[0].pathway.toLowerCase().replace(/_/g, ' ')} · ${m.verifications[0].status.toLowerCase()}` : '—'}</td>
                  <td className="small">{date(m.updatedAt)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Nothing in this queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <MerchantsList />
    </Suspense>
  );
}
