'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Loading, Stat } from '@/components/ui';
import { naira, pct } from '@/lib/format';
import { useApi } from '@/lib/hooks';

type Metrics = Record<string, number | boolean | string[] | null>;
interface Analytics {
  period: { from: string; to: string };
  segments: Record<string, Metrics>;
  merchants: { bySegment: Record<string, { registered: number; submitted: number; approved: number; suspended: number }>; registeredCustomers: number };
}

const SEGMENTS = ['ALL', 'GALAXY_MALL', 'HOME_VENDOR', 'INDEPENDENT', 'OTHER_MARKET'];
const SEG_LABEL: Record<string, string> = { ALL: 'All', GALAXY_MALL: 'Galaxy Mall', HOME_VENDOR: 'Home vendors', INDEPENDENT: 'Independent', OTHER_MARKET: 'Other markets' };
const ROWS: [string, string, 'n' | 'm' | 'p'][] = [
  ['ordersInitiated', 'Orders initiated', 'n'],
  ['paidOrders', 'Paid orders', 'n'],
  ['ordersCompleted', 'Orders completed', 'n'],
  ['ordersCancelled', 'Orders cancelled', 'n'],
  ['checkoutConversion', 'Order → payment conversion', 'p'],
  ['failedPayments', 'Failed payment attempts', 'n'],
  ['gmvMinor', 'GMV (goods, before refunds)', 'm'],
  ['platformRevenueMinor', 'Platform revenue (commission + service fees)', 'm'],
  ['deliveryFeesRetainedMinor', 'Delivery fees retained (pass-through)', 'm'],
  ['refundsMinor', 'Refunds paid', 'm'],
  ['providerFeesMinor', 'Payment provider fees', 'm'],
  ['logisticsCostsMinor', 'Logistics costs recorded', 'm'],
  ['contributionMarginMinor', 'Contribution margin', 'm'],
  ['activeMerchants', 'Transacting merchants', 'n'],
  ['merchantRetention', 'Merchant retention (vs previous period)', 'p'],
  ['repeatPurchaseRate', 'Repeat purchase rate', 'p'],
  ['avgHoursPaidToDelivered', 'Avg hours paid → delivered', 'n'],
  ['failedDeliveryAttempts', 'Failed delivery attempts', 'n'],
  ['disputesOpened', 'Disputes opened', 'n'],
];

export default function AdminOverview() {
  const [days, setDays] = useState(30);
  // Computed once per period selection; recomputing per render would refetch in a loop.
  const from = useMemo(() => new Date(Date.now() - days * 86400_000).toISOString(), [days]);
  const overview = useApi<{ queues: Record<string, number> }>('/admin/overview');
  const analytics = useApi<Analytics>(`/admin/analytics?from=${encodeURIComponent(from)}`);
  const q = overview.data?.queues;
  const fmt = (v: unknown, t: 'n' | 'm' | 'p') => (v == null ? '—' : t === 'm' ? naira(v as number) : t === 'p' ? pct(v as number) : typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : String(v));
  return (
    <div className="stack">
      {q && (
        <div className="stat-grid">
          <Link href="/admin/merchants?status=PENDING_REVIEW">
            <Stat label="Merchants to review" value={q.pendingMerchants} />
          </Link>
          <Link href="/admin/moderation">
            <Stat label="Products / affiliations / reports" value={`${q.pendingProducts} / ${q.pendingAffiliations} / ${q.openReports}`} />
          </Link>
          <Link href="/admin/disputes">
            <Stat label="Open disputes" value={q.openDisputes} />
          </Link>
          <Link href="/admin/fulfilment">
            <Stat label="Courier deliveries to arrange" value={q.awaitingDispatch} />
          </Link>
          <Link href="/admin/finance">
            <Stat label="Refunds awaiting approval" value={q.refundsAwaiting} note={q.failedRefunds ? `${q.failedRefunds} failed — action needed` : undefined} />
          </Link>
          <Link href="/admin/finance">
            <Stat label="Unprocessed webhooks" value={q.unprocessedWebhooks} />
          </Link>
        </div>
      )}
      <section className="card stack-sm">
        <div className="row-between">
          <h2 className="mb-0">Performance by segment</h2>
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ maxWidth: 180 }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        </div>
        {analytics.loading && <Loading />}
        {analytics.error && <Alert tone="error">{analytics.error.message}</Alert>}
        {analytics.data && (
          <>
            {analytics.data.segments.ALL.contributionMarginComplete === false && (
              <Alert tone="warn" title="Contribution margin is incomplete">
                {(analytics.data.segments.ALL.contributionMarginNotes as string[]).join('; ')}. Unknown costs are not assumed to be zero.
              </Alert>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    {SEGMENTS.map((s) => (
                      <th key={s} scope="col" className="num">
                        {SEG_LABEL[s]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([k, label, t]) => (
                    <tr key={k}>
                      <td>{label}</td>
                      {SEGMENTS.map((s) => (
                        <td key={s} className="num">
                          {fmt(analytics.data!.segments[s]?.[k], t)}
                          {k === 'contributionMarginMinor' && analytics.data!.segments[s]?.contributionMarginComplete === false && <span title="Incomplete cost data"> *</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td>Merchants approved / registered</td>
                    {SEGMENTS.map((s) => (
                      <td key={s} className="num">
                        {analytics.data!.merchants.bySegment[s]?.approved ?? 0} / {analytics.data!.merchants.bySegment[s]?.registered ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="meta mb-0">
              Platform-wide: {analytics.data.merchants.registeredCustomers} registered customers · {analytics.data.segments.ALL.searches as number} searches · {pct(analytics.data.segments.ALL.searchToProductRate as number | null)} search → product · {analytics.data.segments.ALL.productViews as number} product views. GMV is the value of goods in paid orders; revenue is KDCN&apos;s commission and service fees; contribution margin subtracts payment and logistics costs. Definitions: docs/ANALYTICS.md.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
