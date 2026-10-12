'use client';

import Link from 'next/link';
import { Alert, Empty, Loading, StatusBadge } from '@/components/ui';
import { date, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Paged } from '@/lib/types';

interface Row {
  id: string;
  number: string;
  status: string;
  totalMinor: number;
  createdAt: string;
  merchant: { displayName: string };
  itemTitles: string[];
}

export default function OrdersPage() {
  const { data, loading, error } = useApi<Paged<Row>>('/orders');
  if (loading) return <Loading label="Loading your orders" />;
  if (error?.status === 401)
    return (
      <Alert tone="info">
        <Link href="/login?next=/orders">Sign in</Link> to see your orders. Guest orders can be found with <Link href="/track">order tracking</Link>.
      </Alert>
    );
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data?.items.length) return <Empty title="No orders yet" action={<Link className="btn" href="/">Start shopping</Link>} />;
  return (
    <div className="stack">
      <h1>Your orders</h1>
      {data.items.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`} className="card-flat row-between" style={{ color: 'inherit' }}>
          <div>
            <strong>{o.number}</strong> · {o.merchant.displayName}
            <div className="meta">
              {o.itemTitles.join(', ')} · {date(o.createdAt)}
            </div>
          </div>
          <div className="row">
            <span className="price">{naira(o.totalMinor)}</span>
            <StatusBadge status={o.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
