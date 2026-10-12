'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { Alert, AvailabilityBadge, Empty, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Availability } from '@/lib/types';

interface Cart {
  groups: {
    merchant: { id: string; slug: string; displayName: string };
    items: { id: string; listingSlug: string; title: string; variantName: string; imageUrl: string | null; unitPriceMinor: number; quantity: number; lineTotalMinor: number; availability: Availability; issues: string[] }[];
    subtotalMinor: number;
    checkoutable: boolean;
    requiresConfirmation: boolean;
  }[];
  itemCount: number;
}

export default function CartPage() {
  const { data, loading, error, setData } = useApi<Cart>('/cart');
  const { refreshCart } = useAuth();
  const update = async (path: string, method: 'PATCH' | 'DELETE', body?: unknown) => {
    setData(await api<Cart>(path, { method, body }));
    await refreshCart();
  };
  if (loading) return <Loading label="Loading your cart" />;
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data || data.groups.length === 0)
    return (
      <Empty title="Your cart is empty" action={<Link className="btn" href="/">Start shopping</Link>}>
        Find products from Galaxy Mall, Kaduna markets and home vendors.
      </Empty>
    );
  return (
    <div className="stack">
      <h1>Your cart</h1>
      {data.groups.length > 1 && <Alert tone="info">Your cart has items from {data.groups.length} sellers. Each seller is checked out separately so each order can be confirmed, paid and delivered on its own.</Alert>}
      {data.groups.map((g) => (
        <section key={g.merchant.id} className="card stack">
          <div className="row-between">
            <h2 className="mb-0">
              <Link href={`/s/${g.merchant.slug}`}>{g.merchant.displayName}</Link>
            </h2>
            <span className="price">{naira(g.subtotalMinor)}</span>
          </div>
          {g.items.map((it) => (
            <div key={it.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
              <div className="thumb" style={{ width: 72, height: 72, borderRadius: 8, flex: '0 0 auto' }}>
                {it.imageUrl ? <img src={it.imageUrl} alt="" width={72} height={72} /> : null}
              </div>
              <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/p/${it.listingSlug}`} style={{ fontWeight: 600 }}>
                  {it.title}
                </Link>
                <div className="meta">
                  {it.variantName} · {naira(it.unitPriceMinor)} each
                </div>
                <AvailabilityBadge a={it.availability} />
                {it.issues.map((i) => (
                  <div key={i} className="error small" style={{ color: 'var(--red-700)' }}>
                    {i}
                  </div>
                ))}
                <div className="row">
                  <label htmlFor={`q-${it.id}`} className="sr-only">
                    Quantity
                  </label>
                  <input id={`q-${it.id}`} type="number" min={1} value={it.quantity} style={{ width: 80 }} onChange={(e) => Number(e.target.value) > 0 && update(`/cart/items/${it.id}`, 'PATCH', { quantity: Number(e.target.value) }).catch(() => undefined)} />
                  <button className="btn-link btn" onClick={() => update(`/cart/items/${it.id}`, 'DELETE')}>
                    Remove
                  </button>
                </div>
              </div>
              <div className="price">{naira(it.lineTotalMinor)}</div>
            </div>
          ))}
          {g.requiresConfirmation && <p className="small muted mb-0">Some items need the seller to confirm availability before you pay.</p>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {g.checkoutable ? (
              <Link className="btn btn-amber" href={`/checkout/${g.merchant.id}`}>
                Checkout with {g.merchant.displayName}
              </Link>
            ) : (
              <span className="small" style={{ color: 'var(--red-700)' }}>
                Fix the issues above to check out
              </span>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
