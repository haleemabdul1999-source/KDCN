'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMerchant } from '@/components/MerchantContext';
import { Alert, Empty, Loading, StatusBadge } from '@/components/ui';
import { naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Paged } from '@/lib/types';

interface Row {
  id: string;
  status: string;
  stockMode: string;
  product: { title: string; images: { url: string }[]; moderationStatus: string };
  variants: { priceMinor: number; quantity: number; reserved: number; active: boolean }[];
}

export default function ProductsPage() {
  const { m } = useMerchant();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi<Paged<Row>>(`/merchant/${m.id}/listings?page=${page}`);
  return (
    <div className="stack">
      <div className="row-between">
        <h2 className="mb-0">Products</h2>
        <Link className="btn" href={`/merchant/${m.id}/products/new`}>
          + Add product
        </Link>
      </div>
      {loading && <Loading />}
      {error && <Alert tone="error">{error.message}</Alert>}
      {data && data.items.length === 0 && <Empty title="No products yet" action={<Link className="btn" href={`/merchant/${m.id}/products/new`}>Add your first product</Link>}>Most sellers start with 3–5 of their best items.</Empty>}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Status</th>
                <th>Price</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => {
                const active = l.variants.filter((v) => v.active);
                return (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/merchant/${m.id}/products/${l.id}`}>{l.product.title}</Link>
                      {l.product.moderationStatus !== 'APPROVED' && (
                        <div>
                          <StatusBadge status={l.product.moderationStatus} label={`Moderation: ${l.product.moderationStatus.toLowerCase().replace('_', ' ')}`} />
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="nowrap">{active.length ? naira(Math.min(...active.map((v) => v.priceMinor))) : '—'}</td>
                    <td className="small">
                      {l.stockMode === 'TRACKED' ? `${active.reduce((n, v) => n + v.quantity - v.reserved, 0)} available` : l.stockMode === 'MADE_TO_ORDER' ? 'Made to order' : 'Confirm per order'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="row">
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className="btn btn-secondary btn-sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
