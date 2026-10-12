'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loading, StatusBadge } from '@/components/ui';
import { date, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Row {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  assignedToId: string | null;
  order: { id: string; number: string; totalMinor: number; merchant: { displayName: string } };
}

export default function Disputes() {
  const [open, setOpen] = useState(true);
  const { data, loading } = useApi<{ items: Row[] }>(`/admin/disputes?open=${open}&pageSize=50`);
  return (
    <div className="stack">
      <div className="chip-row">
        <button className="chip" aria-current={open} onClick={() => setOpen(true)}>
          Open
        </button>
        <button className="chip" aria-current={!open} onClick={() => setOpen(false)}>
          All
        </button>
      </div>
      {loading && <Loading />}
      {data?.items.length === 0 && <p className="muted">No disputes.</p>}
      {data?.items.map((d) => (
        <Link
          key={d.id}
          href={`/admin/disputes/${d.id}`}
          className="card-flat row-between"
          style={{ color: 'inherit' }}
        >
          <span>
            <strong>{d.order.number}</strong> · {d.order.merchant.displayName} ·{' '}
            {d.reason.replace(/_/g, ' ')} · {naira(d.order.totalMinor)}
            <div className="meta">
              Opened {date(d.createdAt, true)} {d.assignedToId ? '· assigned' : '· unassigned'}
            </div>
          </span>
          <StatusBadge status={d.status} />
        </Link>
      ))}
    </div>
  );
}
