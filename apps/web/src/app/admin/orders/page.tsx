'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { date, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Row {
  id: string;
  number: string;
  status: string;
  segment: string;
  totalMinor: number;
  fulfilmentMethod: string;
  createdAt: string;
  merchant: { displayName: string };
}

export default function AdminOrders() {
  const [status, setStatus] = useState('');
  const [segment, setSegment] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi<{ items: Row[]; total: number; pageSize: number }>(
    `/admin/orders?page=${page}&pageSize=50${status ? `&status=${status}` : ''}${segment ? `&segment=${segment}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  return (
    <div className="stack">
      <div className="row">
        <input
          type="search"
          aria-label="Order number"
          placeholder="Order number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ maxWidth: 260 }}
        >
          <option value="">All statuses</option>
          {[
            'PENDING_MERCHANT_CONFIRMATION',
            'AWAITING_PAYMENT',
            'PAYMENT_PENDING_VERIFICATION',
            'PAID',
            'ACCEPTED_FOR_FULFILMENT',
            'PREPARING',
            'READY_FOR_COLLECTION',
            'DISPATCHED',
            'DELIVERED',
            'COMPLETED',
            'CANCELLED',
            'REFUND_PENDING',
            'REFUNDED',
            'DISPUTED',
          ].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
        <select
          aria-label="Segment"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          <option value="">All segments</option>
          <option value="GALAXY_MALL">Galaxy Mall</option>
          <option value="HOME_VENDOR">Home vendors</option>
          <option value="INDEPENDENT">Independent</option>
          <option value="OTHER_MARKET">Other markets</option>
        </select>
      </div>
      {loading && <Loading />}
      {error && <Alert tone="error">{error.message}</Alert>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Merchant</th>
                <th>Segment</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/orders/${o.id}`}>{o.number}</Link>
                  </td>
                  <td>{o.merchant.displayName}</td>
                  <td className="small">{o.segment.replace('_', ' ').toLowerCase()}</td>
                  <td className="num">{naira(o.totalMinor)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="small">{date(o.createdAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="row">
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span className="meta">
            {data.total} orders · page {page}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
