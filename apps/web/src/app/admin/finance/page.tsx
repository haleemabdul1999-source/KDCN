'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Refund {
  id: string;
  amountMinor: number;
  status: string;
  reason: string;
  failureReason: string | null;
  createdAt: string;
  order: { id: string; number: string };
  paymentTransaction: { reference: string; provider: string; isDuplicate: boolean };
}
interface Settlement {
  id: string;
  status: string;
  mode: string;
  grossMinor: number;
  commissionMinor: number;
  merchantNetMinor: number;
  refundedMinor: number;
  payoutReference: string | null;
  order: { number: string; status: string };
  merchant: {
    displayName: string;
    payoutAccountName: string | null;
    payoutBankCode: string | null;
  };
}
interface Payment {
  id: string;
  reference: string;
  provider: string;
  status: string;
  amountMinor: number;
  providerFeeMinor: number | null;
  isDuplicate: boolean;
  isTestMode: boolean;
  createdAt: string;
  order: { id: string; number: string };
}
interface Webhook {
  id: string;
  provider: string;
  eventType: string;
  eventKey: string;
  receivedAt: string;
  processedAt: string | null;
  result: string | null;
  deliveryCount: number;
}
interface Rule {
  id: string;
  scope: string;
  scopeValue: string;
  rateBps: number;
  serviceFeeMinor: number;
  active: boolean;
}

export default function Finance() {
  const [tab, setTab] = useState('refunds');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const refunds = useApi<{ items: Refund[] }>(
    tab === 'refunds' ? '/admin/refunds?pageSize=50' : null,
  );
  const settlements = useApi<{ items: Settlement[] }>(
    tab === 'settlements' ? '/admin/settlements?status=ELIGIBLE&pageSize=50' : null,
  );
  const payments = useApi<{ items: Payment[] }>(
    tab === 'payments' ? '/admin/payments?pageSize=50' : null,
  );
  const webhooks = useApi<{ items: Webhook[] }>(
    tab === 'webhooks' ? '/admin/webhook-events?pageSize=50' : null,
  );
  const rules = useApi<Rule[]>(tab === 'commission' ? '/admin/commission-rules' : null);
  const [selected, setSelected] = useState<string[]>([]);
  const [payoutRef, setPayoutRef] = useState('');
  const [rule, setRule] = useState({
    scope: 'DEFAULT',
    scopeValue: '',
    ratePct: '5',
    serviceFee: '100',
  });

  const run = async (fn: () => Promise<unknown>, ok: string, reload: () => Promise<void>) => {
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
      <div className="chip-row">
        {[
          ['refunds', 'Refunds'],
          ['settlements', 'Payouts due'],
          ['payments', 'Payments'],
          ['webhooks', 'Webhook log'],
          ['commission', 'Commission'],
        ].map(([v, l]) => (
          <button key={v} className="chip" aria-current={tab === v} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {tab === 'refunds' &&
        (refunds.loading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Reason</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {refunds.data?.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/orders/${r.order.id}`}>{r.order.number}</Link>
                      <div className="meta">{date(r.createdAt, true)}</div>
                    </td>
                    <td className="small">
                      {r.reason}
                      {r.paymentTransaction.isDuplicate && (
                        <span className="badge badge-red">duplicate payment</span>
                      )}
                      {r.failureReason && <div className="meta">{r.failureReason}</div>}
                    </td>
                    <td className="num">{naira(r.amountMinor)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="nowrap">
                      {r.status === 'REQUESTED' && (
                        <>
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              run(
                                () => api(`/admin/refunds/${r.id}/approve`, { method: 'POST' }),
                                'Refund approved and sent to provider',
                                refunds.reload,
                              )
                            }
                          >
                            Approve
                          </button>{' '}
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() =>
                              run(
                                () =>
                                  api(`/admin/refunds/${r.id}/reject`, {
                                    body: { reason: 'Not eligible under terms' },
                                  }),
                                'Refund rejected',
                                refunds.reload,
                              )
                            }
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {r.status === 'FAILED' && (
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            run(
                              () => api(`/admin/refunds/${r.id}/retry`, { method: 'POST' }),
                              'Retried',
                              refunds.reload,
                            )
                          }
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'settlements' && (
        <div className="stack-sm">
          <Alert tone="info">
            Completed orders eligible for payout. Record the bank transfer (or confirmed provider
            settlement) reference after paying the merchant. Under “manual record” mode, customer
            payments settle to KDCN&apos;s provider account before transfer to merchants — this
            arrangement requires legal and payment-provider confirmation before live use
            (docs/PAYMENTS.md). Provider split settlement pays merchants directly.
          </Alert>
          {settlements.loading ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Order</th>
                    <th>Merchant / payout account</th>
                    <th className="num">Goods</th>
                    <th className="num">Commission</th>
                    <th className="num">Merchant net</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.data?.items.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.order.number}`}
                          checked={selected.includes(s.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, s.id]
                                : selected.filter((x) => x !== s.id),
                            )
                          }
                        />
                      </td>
                      <td>{s.order.number}</td>
                      <td className="small">
                        {s.merchant.displayName}
                        <div className="meta">
                          {s.merchant.payoutAccountName} · bank {s.merchant.payoutBankCode}
                        </div>
                      </td>
                      <td className="num">{naira(s.grossMinor)}</td>
                      <td className="num">{naira(s.commissionMinor)}</td>
                      <td className="num">
                        <strong>{naira(s.merchantNetMinor)}</strong>
                      </td>
                      <td className="small">{s.mode.replace('_', ' ').toLowerCase()}</td>
                    </tr>
                  ))}
                  {settlements.data?.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        Nothing due.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className="row">
            <input
              aria-label="Payout reference"
              type="text"
              placeholder="Transfer reference"
              value={payoutRef}
              onChange={(e) => setPayoutRef(e.target.value)}
              style={{ maxWidth: 260 }}
            />
            <button
              className="btn"
              disabled={!selected.length || payoutRef.length < 3}
              onClick={() =>
                run(
                  () =>
                    api('/admin/settlements/mark-settled', {
                      body: { settlementIds: selected, payoutReference: payoutRef },
                    }),
                  `${selected.length} settlement(s) marked paid`,
                  async () => {
                    setSelected([]);
                    await settlements.reload();
                  },
                )
              }
            >
              Mark {selected.length} as paid out
            </button>
          </div>
        </div>
      )}

      {tab === 'payments' &&
        (payments.loading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                  <th className="num">Provider fee</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payments.data?.items.map((p) => (
                  <tr key={p.id}>
                    <td className="small">
                      {p.reference} {p.isTestMode && <span className="badge badge-test">TEST</span>}{' '}
                      {p.isDuplicate && <span className="badge badge-red">duplicate</span>}
                      <div className="meta">
                        {p.provider} · {date(p.createdAt, true)}
                      </div>
                    </td>
                    <td>
                      <Link href={`/admin/orders/${p.order.id}`}>{p.order.number}</Link>
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="num">{naira(p.amountMinor)}</td>
                    <td className="num">{naira(p.providerFeeMinor)}</td>
                    <td>
                      {['PENDING', 'INITIATED'].includes(p.status) && (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() =>
                            run(
                              () =>
                                api(
                                  `/admin/payments/${encodeURIComponent(p.reference)}/reconcile`,
                                  { method: 'POST' },
                                ),
                              'Re-verified',
                              payments.reload,
                            )
                          }
                        >
                          Re-verify
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'webhooks' &&
        (webhooks.loading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Provider / event</th>
                  <th>Deliveries</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.data?.items.map((w) => (
                  <tr key={w.id}>
                    <td className="small">{date(w.receivedAt, true)}</td>
                    <td className="small">
                      {w.provider} · {w.eventType}
                      <div className="meta">{w.eventKey.slice(0, 60)}</div>
                    </td>
                    <td className="num">{w.deliveryCount}</td>
                    <td className="small">
                      {w.processedAt ? (
                        w.result
                      ) : (
                        <span className="badge badge-red">
                          unprocessed: {w.result ?? 'pending'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'commission' && (
        <div className="stack-sm">
          {rules.data && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Applies to</th>
                    <th className="num">Commission</th>
                    <th className="num">Service fee</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data.map((r) => (
                    <tr key={r.id}>
                      <td>{r.scope}</td>
                      <td className="small">{r.scopeValue || 'everyone'}</td>
                      <td className="num">{(r.rateBps / 100).toFixed(2)}%</td>
                      <td className="num">{naira(r.serviceFeeMinor)}</td>
                      <td>{r.active ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form
            className="card row"
            style={{ alignItems: 'flex-end' }}
            onSubmit={(e) => (
              e.preventDefault(),
              run(
                () =>
                  api('/admin/commission-rules', {
                    method: 'PUT',
                    body: {
                      scope: rule.scope,
                      scopeValue: rule.scopeValue,
                      rateBps: Math.round(Number(rule.ratePct) * 100),
                      serviceFeeMinor: Math.round(Number(rule.serviceFee) * 100),
                    },
                  }),
                'Rule saved (applies to new orders only)',
                rules.reload,
              )
            )}
          >
            <div className="field">
              <label htmlFor="sc">Scope</label>
              <select
                id="sc"
                value={rule.scope}
                onChange={(e) => setRule({ ...rule, scope: e.target.value })}
              >
                <option>DEFAULT</option>
                <option>MERCHANT_TYPE</option>
                <option>MARKET</option>
                <option>MERCHANT</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sv">Value (type / market id / merchant id)</label>
              <input
                id="sv"
                type="text"
                value={rule.scopeValue}
                onChange={(e) => setRule({ ...rule, scopeValue: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="rp">Commission %</label>
              <input
                id="rp"
                type="number"
                step="0.01"
                min={0}
                max={50}
                value={rule.ratePct}
                onChange={(e) => setRule({ ...rule, ratePct: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="sf">Service fee ₦</label>
              <input
                id="sf"
                type="number"
                min={0}
                value={rule.serviceFee}
                onChange={(e) => setRule({ ...rule, serviceFee: e.target.value })}
              />
            </div>
            <div className="field">
              <button className="btn">Save rule</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
