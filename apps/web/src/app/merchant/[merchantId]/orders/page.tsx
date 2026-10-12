'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useMerchant } from '@/components/MerchantContext';
import { Alert, Empty, Loading, StatusBadge } from '@/components/ui';
import { date, FULFILMENT_LABEL, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Row {
  id: string;
  number: string;
  status: string;
  subtotalMinor: number;
  fulfilmentMethod: string;
  createdAt: string;
  confirmationDeadline: string | null;
  items: { title: string; variantName: string; quantity: number }[];
}

function Orders() {
  const { m } = useMerchant();
  const initial = useSearchParams().get('bucket') ?? 'action';
  const [bucket, setBucket] = useState(initial);
  const { data, loading, error } = useApi<{ items: Row[]; total: number; counts: Record<string, number> }>(`/merchant/${m.id}/orders?bucket=${bucket}&pageSize=50`);
  return (
    <div className="stack">
      <div className="chip-row" role="tablist">
        {[
          ['action', 'Needs action'],
          ['active', 'In progress'],
          ['done', 'Completed / cancelled'],
          ['all', 'All'],
        ].map(([v, l]) => (
          <button key={v} className="chip" aria-current={bucket === v} onClick={() => setBucket(v)}>
            {l}
          </button>
        ))}
      </div>
      {loading && <Loading />}
      {error && <Alert tone="error">{error.message}</Alert>}
      {data?.items.length === 0 && <Empty title="No orders here">When customers order, they&apos;ll appear here and you&apos;ll get an email and SMS.</Empty>}
      {data?.items.map((o) => (
        <Link key={o.id} href={`/merchant/${m.id}/orders/${o.id}`} className="card-flat" style={{ display: 'block', color: 'inherit' }}>
          <div className="row-between">
            <strong>{o.number}</strong>
            <StatusBadge status={o.status} />
          </div>
          <div className="small">{o.items.map((i) => `${i.quantity} × ${i.title} (${i.variantName})`).join(', ')}</div>
          <div className="meta">
            {naira(o.subtotalMinor)} · {FULFILMENT_LABEL[o.fulfilmentMethod]} · {date(o.createdAt, true)}
            {o.status === 'PENDING_MERCHANT_CONFIRMATION' && o.confirmationDeadline && <strong style={{ color: 'var(--amber-600)' }}> · confirm by {date(o.confirmationDeadline, true)}</strong>}
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Orders />
    </Suspense>
  );
}
