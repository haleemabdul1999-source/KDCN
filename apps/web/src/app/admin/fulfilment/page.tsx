'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date, FULFILMENT_LABEL } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Row {
  id: string;
  method: string;
  status: string;
  failedAttempts: number;
  pickupFromMerchant: boolean;
  logisticsCostMinor: number | null;
  updatedAt: string;
  order: {
    id: string;
    number: string;
    status: string;
    paidAt: string;
    merchant: { displayName: string; contactPhone: string };
  };
  collectionPoint: { name: string } | null;
  assignments: { partnerName: string; riderName: string | null; status: string }[];
}

export default function Fulfilment() {
  const [method, setMethod] = useState('THIRD_PARTY_DELIVERY');
  const { data, loading, reload } = useApi<{ items: Row[] }>(
    `/admin/fulfilments?pageSize=50${method ? `&method=${method}` : ''}`,
  );
  const [forms, setForms] = useState<
    Record<
      string,
      { partnerName: string; riderName: string; riderPhone: string; cost: string; note: string }
    >
  >({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const f = (id: string) =>
    forms[id] ?? { partnerName: '', riderName: '', riderPhone: '', cost: '', note: '' };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    }
  };
  return (
    <div className="stack">
      <Alert tone="info">
        Manual dispatch coordination: assign a courier partner and rider, then record delivery or
        failed attempts. Live tracking is not available until a courier integration is connected.
      </Alert>
      <select
        aria-label="Method"
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        style={{ maxWidth: 300 }}
      >
        <option value="THIRD_PARTY_DELIVERY">KDCN-arranged courier deliveries</option>
        <option value="MERCHANT_DELIVERY">Merchant deliveries</option>
        <option value="COLLECTION_POINT">Collection points</option>
        <option value="IN_STORE_COLLECTION">In-store collections</option>
        <option value="">All</option>
      </select>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {loading && <Loading />}
      {data?.items.length === 0 && <p className="muted">Nothing active.</p>}
      {data?.items.map((x) => {
        const v = f(x.id);
        const set = (patch: Partial<typeof v>) =>
          setForms({ ...forms, [x.id]: { ...v, ...patch } });
        return (
          <div key={x.id} className="card-flat stack-sm">
            <div className="row-between">
              <span>
                <Link href={`/admin/orders/${x.order.id}`}>{x.order.number}</Link> ·{' '}
                {x.order.merchant.displayName} ({x.order.merchant.contactPhone}) ·{' '}
                {FULFILMENT_LABEL[x.method]}
                {x.pickupFromMerchant && (
                  <span className="badge badge-amber">Pick up from vendor</span>
                )}
                <div className="meta">
                  Paid {date(x.order.paidAt, true)} · {x.failedAttempts} failed attempt(s){' '}
                  {x.assignments[0] &&
                    `· ${x.assignments[0].partnerName} ${x.assignments[0].riderName ?? ''} (${x.assignments[0].status.toLowerCase()})`}
                </div>
              </span>
              <span className="row">
                <StatusBadge status={x.order.status} />{' '}
                <span className="badge">{x.status.toLowerCase()}</span>
              </span>
            </div>
            {x.method === 'THIRD_PARTY_DELIVERY' &&
              ['ACCEPTED_FOR_FULFILMENT', 'PREPARING'].includes(x.order.status) && (
                <form
                  className="row"
                  onSubmit={(e) => (
                    e.preventDefault(),
                    run(
                      () =>
                        api(`/admin/orders/${x.order.id}/fulfilment/dispatch`, {
                          body: {
                            partnerName: v.partnerName,
                            riderName: v.riderName || undefined,
                            riderPhone: v.riderPhone || undefined,
                            logisticsCostMinor: v.cost
                              ? Math.round(Number(v.cost) * 100)
                              : undefined,
                          },
                        }),
                      'Dispatched',
                    )
                  )}
                >
                  <input
                    aria-label="Courier"
                    type="text"
                    required
                    placeholder="Courier partner"
                    value={v.partnerName}
                    onChange={(e) => set({ partnerName: e.target.value })}
                    style={{ maxWidth: 180 }}
                  />
                  <input
                    aria-label="Rider"
                    type="text"
                    placeholder="Rider name"
                    value={v.riderName}
                    onChange={(e) => set({ riderName: e.target.value })}
                    style={{ maxWidth: 150 }}
                  />
                  <input
                    aria-label="Rider phone"
                    type="tel"
                    placeholder="Rider phone"
                    value={v.riderPhone}
                    onChange={(e) => set({ riderPhone: e.target.value })}
                    style={{ maxWidth: 150 }}
                  />
                  <input
                    aria-label="Cost ₦"
                    type="number"
                    min={0}
                    placeholder="Our cost ₦"
                    value={v.cost}
                    onChange={(e) => set({ cost: e.target.value })}
                    style={{ maxWidth: 120 }}
                  />
                  <button className="btn btn-sm">Dispatch</button>
                </form>
              )}
            {x.order.status === 'DISPATCHED' && (
              <div className="row">
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    run(
                      () => api(`/admin/orders/${x.order.id}/fulfilment/delivered`, { body: {} }),
                      'Marked delivered',
                    )
                  }
                >
                  Mark delivered
                </button>
                <input
                  aria-label="Failure note"
                  type="text"
                  placeholder="Why did it fail?"
                  value={v.note}
                  onChange={(e) => set({ note: e.target.value })}
                  style={{ maxWidth: 240 }}
                />
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={v.note.length < 3}
                  onClick={() =>
                    run(
                      () =>
                        api(`/admin/orders/${x.order.id}/fulfilment/failed`, {
                          body: { note: v.note },
                        }),
                      'Failed attempt recorded',
                    )
                  }
                >
                  Failed attempt
                </button>
              </div>
            )}
            {x.method === 'THIRD_PARTY_DELIVERY' &&
              x.logisticsCostMinor == null &&
              x.order.status !== 'ACCEPTED_FOR_FULFILMENT' && (
                <p className="meta mb-0">
                  Logistics cost not recorded — contribution margin will be marked incomplete.
                </p>
              )}
          </div>
        );
      })}
    </div>
  );
}
