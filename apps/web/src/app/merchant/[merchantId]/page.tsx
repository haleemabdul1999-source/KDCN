'use client';

import Link from 'next/link';
import { useMerchant } from '@/components/MerchantContext';
import { Alert, Loading, Stat } from '@/components/ui';
import { naira, pct } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Analytics {
  paidOrders: number;
  ordersInitiated: number;
  ordersCompleted: number;
  ordersCancelled: number;
  salesMinor: number;
  commissionAndFeesMinor: number;
  refundsMinor: number;
  productViews: number | null;
  storefrontViews: number;
  checkoutConversion: number | null;
  avgHoursPaidToDelivered: number | null;
  disputesOpened: number;
  topListings: { listingId: string; title: string; quantity: number; salesMinor: number }[];
}

export default function MerchantOverview() {
  const { m } = useMerchant();
  const base = `/merchant/${m.id}`;
  const orders = useApi<{ total: number; counts: Record<string, number> }>(`${base}/orders?bucket=action&pageSize=1`);
  const analytics = useApi<Analytics>(m.myRole !== 'STAFF' ? `${base}/analytics` : null);
  const c = orders.data?.counts ?? {};
  return (
    <div className="stack">
      <section className="card stack-sm">
        <h2>Needs your attention</h2>
        {orders.loading ? (
          <Loading />
        ) : (
          <div className="stat-grid">
            <Link href={`${base}/orders?bucket=action`}>
              <Stat label="Confirm availability" value={c.PENDING_MERCHANT_CONFIRMATION ?? 0} note="Customers are waiting" />
            </Link>
            <Link href={`${base}/orders?bucket=action`}>
              <Stat label="Paid — accept now" value={c.PAID ?? 0} />
            </Link>
            <Link href={`${base}/orders?bucket=active`}>
              <Stat label="In progress" value={(c.ACCEPTED_FOR_FULFILMENT ?? 0) + (c.PREPARING ?? 0) + (c.READY_FOR_COLLECTION ?? 0) + (c.DISPATCHED ?? 0)} />
            </Link>
            <Link href={`${base}/customers`}>
              <Stat label="Open disputes" value={c.DISPUTED ?? 0} />
            </Link>
          </div>
        )}
      </section>
      {analytics.data && (
        <section className="card stack-sm">
          <h2>Last 30 days</h2>
          <div className="stat-grid">
            <Stat label="Sales (goods)" value={naira(analytics.data.salesMinor)} note={`${analytics.data.paidOrders} paid orders`} />
            <Stat label="Completed orders" value={analytics.data.ordersCompleted} />
            <Stat label="Product views" value={analytics.data.productViews ?? 0} note={`${analytics.data.storefrontViews} storefront visits`} />
            <Stat label="Order → payment" value={pct(analytics.data.checkoutConversion)} note={`${analytics.data.ordersCancelled} cancelled`} />
            <Stat label="KDCN commission & fees" value={naira(analytics.data.commissionAndFeesMinor)} />
            <Stat label="Refunds" value={naira(analytics.data.refundsMinor)} />
            <Stat label="Avg. paid → delivered" value={analytics.data.avgHoursPaidToDelivered != null ? `${analytics.data.avgHoursPaidToDelivered.toFixed(1)} h` : '—'} />
            <Stat label="Disputes opened" value={analytics.data.disputesOpened} />
          </div>
          {analytics.data.topListings.length > 0 && (
            <>
              <h3>Top products</h3>
              <ul className="small">
                {analytics.data.topListings.map((t) => (
                  <li key={t.listingId}>
                    {t.title} — {t.quantity} sold · {naira(t.salesMinor)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {m.status === 'APPROVED' && (
        <Alert tone="info">
          Share your storefront: <Link href={`/s/${m.slug}`}>/s/{m.slug}</Link> — add it to your WhatsApp status and Instagram bio.
        </Alert>
      )}
      <div className="row">
        <Link className="btn" href={`${base}/products/new`}>
          + Add a product
        </Link>
        <Link className="btn btn-secondary" href={`${base}/orders`}>
          View orders
        </Link>
      </div>
    </div>
  );
}
