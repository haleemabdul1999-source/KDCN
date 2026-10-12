'use client';

import { useMerchant } from '@/components/MerchantContext';
import { Alert, Empty, Loading, StatusBadge } from '@/components/ui';
import { date, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Settlements {
  items: { id: string; orderNumber: string; paidAt: string | null; grossMinor: number; commissionMinor: number; merchantDeliveryMinor: number; refundedMinor: number; merchantNetMinor: number; status: string; mode: string; payoutReference: string | null; settledAt: string | null }[];
  totalsByStatus: { status: string; merchantNetMinor: number }[];
}

const STATUS_HELP: Record<string, string> = {
  PENDING_FULFILMENT: 'Paid — becomes payable once delivered/collected',
  ELIGIBLE: 'Due to you — included in the next payout',
  SETTLED: 'Paid out',
  ON_HOLD: 'On hold while a dispute is reviewed',
  REVERSED: 'Fully refunded to the customer',
};

export default function PayoutsPage() {
  const { m } = useMerchant();
  const { data, loading, error } = useApi<Settlements>(m.myRole === 'STAFF' ? null : `/merchant/${m.id}/settlements`);
  if (m.myRole === 'STAFF') return <Alert tone="info">Only owners and managers can view payouts.</Alert>;
  if (loading) return <Loading />;
  if (error) return <Alert tone="error">{error.message}</Alert>;
  const total = (s: string) => data?.totalsByStatus.find((t) => t.status === s)?.merchantNetMinor ?? 0;
  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Due to you</div>
          <div className="value">{naira(total('ELIGIBLE'))}</div>
        </div>
        <div className="stat">
          <div className="label">Awaiting delivery</div>
          <div className="value">{naira(total('PENDING_FULFILMENT'))}</div>
        </div>
        <div className="stat">
          <div className="label">On hold (disputes)</div>
          <div className="value">{naira(total('ON_HOLD'))}</div>
        </div>
        <div className="stat">
          <div className="label">Paid out</div>
          <div className="value">{naira(total('SETTLED'))}</div>
        </div>
      </div>
      <Alert tone="info">
        Payout account: {m.payout ? `${m.payout.accountName} ${m.payout.accountNumberMasked}` : 'not set'} ·{' '}
        {m.settlementMode === 'PROVIDER_SPLIT' ? 'Your share is settled directly to your bank by the payment provider.' : 'KDCN finance transfers amounts due after reconciliation and records the transfer reference here.'}
      </Alert>
      {!data?.items.length ? (
        <Empty title="No earnings yet">Earnings appear here once customers pay for orders.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th className="num">Goods</th>
                <th className="num">Commission</th>
                <th className="num">Delivery</th>
                <th className="num">Refunds</th>
                <th className="num">You receive</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.orderNumber}
                    <div className="meta">{date(s.paidAt)}</div>
                  </td>
                  <td className="num">{naira(s.grossMinor)}</td>
                  <td className="num">−{naira(s.commissionMinor)}</td>
                  <td className="num">{naira(s.merchantDeliveryMinor)}</td>
                  <td className="num">{s.refundedMinor ? `−${naira(s.refundedMinor)}` : '—'}</td>
                  <td className="num">
                    <strong>{naira(s.merchantNetMinor)}</strong>
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                    <div className="meta">{s.payoutReference ? `Ref ${s.payoutReference} · ${date(s.settledAt)}` : STATUS_HELP[s.status]}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
