'use client';

import { useEffect, useState } from 'react';
import { useMerchant } from '@/components/MerchantContext';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { FULFILMENT_LABEL, naira } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Readiness {
  merchantStatus: string;
  pathway: string;
  verification: { status: string; requestNote: string | null } | null;
  documents: { id: string; type: string; originalName: string }[];
  checklist: { key: string; label: string; done: boolean }[];
  canSubmit: boolean;
}
interface City {
  name: string;
  areas: { id: string; name: string }[];
}
interface CollectionPoint {
  id: string;
  name: string;
  publicAddress: string;
  marketId: string | null;
  market: { name: string } | null;
}
interface Market {
  id: string;
  slug: string;
  name: string;
}

const DOC_TYPES: [string, string][] = [
  ['GOVERNMENT_ID', 'Government photo ID'],
  ['SELFIE', 'Selfie holding your ID'],
  ['CAC_CERTIFICATE', 'CAC certificate'],
  ['TENANCY_OR_SHOP_ALLOCATION', 'Shop tenancy / allocation letter'],
  ['PROOF_OF_ADDRESS', 'Proof of address'],
  ['FOOD_HANDLING_PERMIT', 'Food handling permit / NAFDAC'],
  ['OTHER', 'Other'],
];

function Section({
  title,
  done,
  children,
}: {
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="card stack-sm">
      <h2 className="row" style={{ margin: 0 }}>
        {done !== undefined && <span aria-hidden="true">{done ? '✅' : '⬜'}</span>} {title}
      </h2>
      {children}
    </section>
  );
}

export default function OnboardingPage() {
  const { m, reload, setM } = useMerchant();
  const base = `/merchant/${m.id}`;
  const readiness = useApi<Readiness>(`${base}/verification`);
  const [cities, setCities] = useState<City[]>([]);
  const [cps, setCps] = useState<CollectionPoint[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [payout, setPayout] = useState({ bankCode: '', accountNumber: '', accountName: '' });
  const [loc, setLoc] = useState({
    label: '',
    areaId: '',
    address: '',
    marketId: '',
    unitLabel: '',
  });
  const [areas, setAreas] = useState(
    m.serviceAreas.map((s) => ({
      areaId: s.areaId,
      fee: String(s.deliveryFeeMinor / 100),
      etaDays: s.etaDays,
    })),
  );
  const [opts, setOpts] = useState(
    m.fulfilmentOptions.map((o) => ({ ...o, fee: String(o.feeMinor / 100) })),
  );
  const [docType, setDocType] = useState('GOVERNMENT_ID');
  const [affMarket, setAffMarket] = useState('');
  const [affUnit, setAffUnit] = useState('');
  const isHome = m.type === 'HOME_VENDOR';
  const isMarket = m.type === 'MALL_RETAILER' || m.type === 'MARKET_TRADER';

  useEffect(() => {
    api<City[]>('/geo/cities')
      .then(setCities)
      .catch(() => undefined);
    api<CollectionPoint[]>('/collection-points')
      .then(setCps)
      .catch(() => undefined);
    api<Market[]>('/markets')
      .then(setMarkets)
      .catch(() => undefined);
  }, []);

  const allAreas = cities.flatMap((c) => c.areas);
  const approvedMarketIds = m.affiliations
    .filter((a) => a.status === 'APPROVED')
    .map((a) => a.market.id);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'id' in r && 'slug' in r)
        setM({ ...(r as typeof m), myRole: m.myRole });
      else await reload();
      await readiness.reload();
      setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({
        tone: 'error',
        text:
          e instanceof ApiError
            ? `${e.message}${e.body.missing ? ': ' + e.body.missing.join('; ') : ''}`
            : 'Failed',
      });
    }
  };
  const check = (key: string) => readiness.data?.checklist.find((c) => c.key === key)?.done;
  const r = readiness.data;

  return (
    <div className="grid-main-side">
      <div className="stack">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        <Section title="Payout bank account" done={check('payout')}>
          {m.payout && (
            <p className="small mb-0">
              Current: {m.payout.accountName} · {m.payout.accountNumberMasked} (bank code{' '}
              {m.payout.bankCode})
            </p>
          )}
          {m.myRole === 'OWNER' ? (
            <form
              className="grid-2"
              onSubmit={(e) => (
                e.preventDefault(),
                run(
                  () => api(`${base}/payout`, { method: 'PUT', body: payout }),
                  'Payout details saved',
                )
              )}
            >
              <div className="field">
                <label htmlFor="bank">Bank code (CBN)</label>
                <input
                  id="bank"
                  inputMode="numeric"
                  required
                  placeholder="e.g. 058"
                  value={payout.bankCode}
                  onChange={(e) => setPayout({ ...payout, bankCode: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="acct">Account number (NUBAN)</label>
                <input
                  id="acct"
                  inputMode="numeric"
                  required
                  maxLength={10}
                  value={payout.accountNumber}
                  onChange={(e) => setPayout({ ...payout, accountNumber: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="acn">Account name</label>
                <input
                  id="acn"
                  required
                  value={payout.accountName}
                  onChange={(e) => setPayout({ ...payout, accountName: e.target.value })}
                />
              </div>
              <div style={{ alignSelf: 'end' }} className="field">
                <button className="btn btn-secondary">Save payout account</button>
              </div>
            </form>
          ) : (
            <p className="small muted">Only the store owner can change payout details.</p>
          )}
        </Section>

        <Section
          title={isHome ? 'Private fulfilment address' : 'Shop location'}
          done={
            isHome
              ? check('private_location')
              : isMarket
                ? check('store_location')
                : m.locations.length > 0
          }
        >
          {isHome && (
            <p className="small muted mb-0">
              Used only so a courier can collect orders, if you choose courier pickup. It is
              encrypted and never shown to customers or on your storefront.
            </p>
          )}
          {m.locations.map((l) => (
            <div key={l.id} className="row-between card-flat small">
              <span>
                <strong>{l.label}</strong> — {l.publicAddress ?? l.privateAddress} ({l.area.name})
                {l.kind === 'PRIVATE_FULFILMENT' && (
                  <span className="badge" style={{ marginLeft: 6 }}>
                    Private
                  </span>
                )}
              </span>
              <button
                className="btn btn-link"
                onClick={() =>
                  run(
                    () => api(`${base}/locations/${l.id}`, { method: 'DELETE' }),
                    'Location removed',
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <form
            className="grid-2"
            onSubmit={(e) => {
              e.preventDefault();
              const body = isHome
                ? {
                    kind: 'PRIVATE_FULFILMENT',
                    label: loc.label,
                    areaId: loc.areaId,
                    privateAddress: loc.address,
                  }
                : {
                    kind: 'PUBLIC_STORE',
                    label: loc.label,
                    areaId: loc.areaId,
                    publicAddress: loc.address,
                    marketId: loc.marketId || undefined,
                    unitLabel: loc.unitLabel || undefined,
                  };
              void run(() => api(`${base}/locations`, { body }), 'Location added');
            }}
          >
            <div className="field">
              <label htmlFor="ll">Label</label>
              <input
                id="ll"
                required
                placeholder={isHome ? 'Home kitchen' : 'Main shop'}
                value={loc.label}
                onChange={(e) => setLoc({ ...loc, label: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="la">Area</label>
              <select
                id="la"
                required
                value={loc.areaId}
                onChange={(e) => setLoc({ ...loc, areaId: e.target.value })}
              >
                <option value="">Choose</option>
                {allAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="lad">
                {isHome ? 'Full address (private)' : 'Shop address (public)'}
              </label>
              <input
                id="lad"
                type="text"
                required
                minLength={5}
                value={loc.address}
                onChange={(e) => setLoc({ ...loc, address: e.target.value })}
              />
            </div>
            {isMarket && (
              <>
                <div className="field">
                  <label htmlFor="lm">Mall / market</label>
                  <select
                    id="lm"
                    value={loc.marketId}
                    onChange={(e) => setLoc({ ...loc, marketId: e.target.value })}
                  >
                    <option value="">—</option>
                    {markets.map((mk) => (
                      <option key={mk.id} value={mk.id}>
                        {mk.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="lu">Shop / unit number</label>
                  <input
                    id="lu"
                    type="text"
                    value={loc.unitLabel}
                    onChange={(e) => setLoc({ ...loc, unitLabel: e.target.value })}
                  />
                </div>
              </>
            )}
            <div>
              <button className="btn btn-secondary">Add location</button>
            </div>
          </form>
        </Section>

        {isMarket && (
          <Section title="Join your mall or market" done={check('affiliation')}>
            {m.affiliations.map((a) => (
              <div key={a.id} className="small">
                {a.market.name} {a.unitLabel && `(${a.unitLabel})`}{' '}
                <StatusBadge status={a.status} />{' '}
                {a.decisionNote && <span className="meta">— {a.decisionNote}</span>}
              </div>
            ))}
            <form
              className="row"
              onSubmit={(e) => (
                e.preventDefault(),
                run(
                  () =>
                    api(`${base}/affiliations`, {
                      body: { marketId: affMarket, unitLabel: affUnit || undefined },
                    }),
                  'Request sent to the market',
                )
              )}
            >
              <select
                aria-label="Market"
                required
                value={affMarket}
                onChange={(e) => setAffMarket(e.target.value)}
                style={{ maxWidth: 260 }}
              >
                <option value="">Choose market</option>
                {markets.map((mk) => (
                  <option key={mk.id} value={mk.id}>
                    {mk.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Shop number"
                type="text"
                placeholder="Shop number"
                value={affUnit}
                onChange={(e) => setAffUnit(e.target.value)}
                style={{ maxWidth: 160 }}
              />
              <button className="btn btn-secondary">Request to join</button>
            </form>
            <p className="small muted mb-0">
              The market&apos;s management confirms your shop before you appear in its directory.
            </p>
          </Section>
        )}

        <Section title="Delivery areas (if you deliver yourself)">
          {areas.map((a, i) => (
            <div key={i} className="row">
              <select
                aria-label="Area"
                value={a.areaId}
                onChange={(e) =>
                  setAreas(areas.map((x, j) => (j === i ? { ...x, areaId: e.target.value } : x)))
                }
                style={{ maxWidth: 200 }}
              >
                <option value="">Choose area</option>
                {allAreas.map((ar) => (
                  <option key={ar.id} value={ar.id}>
                    {ar.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Fee in naira"
                type="number"
                min={0}
                value={a.fee}
                onChange={(e) =>
                  setAreas(areas.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))
                }
                style={{ maxWidth: 120 }}
                placeholder="Fee ₦"
              />
              <input
                aria-label="Days"
                type="number"
                min={0}
                value={a.etaDays}
                onChange={(e) =>
                  setAreas(
                    areas.map((x, j) => (j === i ? { ...x, etaDays: Number(e.target.value) } : x)),
                  )
                }
                style={{ maxWidth: 80 }}
              />
              <span className="meta">days</span>
              <button
                className="btn btn-link"
                onClick={() => setAreas(areas.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="row">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setAreas([...areas, { areaId: '', fee: '0', etaDays: 1 }])}
            >
              + Add area
            </button>
            <button
              className="btn btn-sm"
              onClick={() =>
                run(
                  () =>
                    api(`${base}/service-areas`, {
                      method: 'PUT',
                      body: {
                        areas: areas
                          .filter((a) => a.areaId)
                          .map((a) => ({
                            areaId: a.areaId,
                            deliveryFeeMinor: Math.round(Number(a.fee) * 100),
                            etaDays: a.etaDays,
                          })),
                      },
                    }),
                  'Delivery areas saved',
                )
              }
            >
              Save delivery areas
            </button>
          </div>
        </Section>

        <Section title="How customers get their orders" done={check('fulfilment')}>
          {isHome && (
            <p className="small muted mb-0">
              Customers never collect from your home. Choose delivery and/or a neutral pickup point.
            </p>
          )}
          {(['IN_STORE_COLLECTION', 'MERCHANT_DELIVERY', 'THIRD_PARTY_DELIVERY'] as const)
            .filter((meth) => !(isHome && meth === 'IN_STORE_COLLECTION'))
            .map((meth) => {
              const cur = opts.find((o) => o.method === meth);
              return (
                <div key={meth} className="row">
                  <label className="checkbox" style={{ minWidth: 260 }}>
                    <input
                      type="checkbox"
                      checked={!!cur?.enabled}
                      onChange={(e) =>
                        setOpts(
                          e.target.checked
                            ? [
                                ...opts.filter((o) => o.method !== meth),
                                {
                                  method: meth,
                                  enabled: true,
                                  collectionPointId: null,
                                  collectionPointName: null,
                                  feeMinor: 0,
                                  fee: '0',
                                  instructions: '',
                                  pickupFromMerchant: meth === 'THIRD_PARTY_DELIVERY' && isHome,
                                },
                              ]
                            : opts.filter((o) => o.method !== meth),
                        )
                      }
                    />
                    {FULFILMENT_LABEL[meth]}
                  </label>
                  {cur && meth === 'THIRD_PARTY_DELIVERY' && (
                    <input
                      aria-label="Courier fee ₦"
                      type="number"
                      min={0}
                      style={{ maxWidth: 140 }}
                      value={cur.fee}
                      onChange={(e) =>
                        setOpts(opts.map((o) => (o === cur ? { ...o, fee: e.target.value } : o)))
                      }
                      placeholder="Fee ₦"
                    />
                  )}
                </div>
              );
            })}
          <h3 className="small" style={{ marginTop: 8 }}>
            Pickup points
          </h3>
          {cps.map((cp) => {
            const restricted = !!cp.marketId && !approvedMarketIds.includes(cp.marketId);
            const cur = opts.find(
              (o) => o.method === 'COLLECTION_POINT' && o.collectionPointId === cp.id,
            );
            return (
              <div key={cp.id} className="row">
                <label className="checkbox" style={{ minWidth: 260 }}>
                  <input
                    type="checkbox"
                    disabled={restricted}
                    checked={!!cur}
                    onChange={(e) =>
                      setOpts(
                        e.target.checked
                          ? [
                              ...opts,
                              {
                                method: 'COLLECTION_POINT',
                                enabled: true,
                                collectionPointId: cp.id,
                                collectionPointName: cp.name,
                                feeMinor: 0,
                                fee: '0',
                                instructions: '',
                                pickupFromMerchant: false,
                              },
                            ]
                          : opts.filter((o) => o !== cur),
                      )
                    }
                  />
                  {cp.name}{' '}
                  <span className="meta">
                    {restricted ? `(${cp.market?.name} stores only)` : ''}
                  </span>
                </label>
                {cur && (
                  <input
                    aria-label="Pickup fee ₦"
                    type="number"
                    min={0}
                    style={{ maxWidth: 140 }}
                    value={cur.fee}
                    onChange={(e) =>
                      setOpts(opts.map((o) => (o === cur ? { ...o, fee: e.target.value } : o)))
                    }
                  />
                )}
              </div>
            );
          })}
          <div>
            <button
              className="btn btn-sm"
              onClick={() =>
                run(
                  () =>
                    api(`${base}/fulfilment-options`, {
                      method: 'PUT',
                      body: {
                        options: opts.map((o) => ({
                          method: o.method,
                          enabled: o.enabled,
                          collectionPointId: o.collectionPointId,
                          feeMinor: Math.round(Number(o.fee || 0) * 100),
                          instructions: o.instructions,
                          pickupFromMerchant: o.pickupFromMerchant,
                        })),
                      },
                    }),
                  'Delivery & collection options saved',
                )
              }
            >
              Save options
            </button>
          </div>
          {m.serviceAreas.length > 0 && (
            <p className="meta mb-0">
              Your delivery fees:{' '}
              {m.serviceAreas.map((s) => `${s.areaName} ${naira(s.deliveryFeeMinor)}`).join(', ')}
            </p>
          )}
        </Section>

        <Section title="Verification documents">
          <p className="small muted mb-0">
            Documents are encrypted and only seen by KDCN verification staff. Images or PDF, up to
            5MB.
          </p>
          {r?.documents.map((d) => (
            <div key={d.id} className="row-between card-flat small">
              <span>
                {DOC_TYPES.find((t) => t[0] === d.type)?.[1]} — {d.originalName}
              </span>
              {m.status !== 'PENDING_REVIEW' && m.myRole === 'OWNER' && (
                <button
                  className="btn btn-link"
                  onClick={() =>
                    run(
                      () => api(`${base}/verification/documents/${d.id}`, { method: 'DELETE' }),
                      'Document removed',
                    )
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {m.myRole === 'OWNER' && m.status !== 'PENDING_REVIEW' && m.status !== 'APPROVED' && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem('file') as HTMLInputElement)
                  .files?.[0];
                if (!input) return;
                const fd = new FormData();
                fd.set('type', docType);
                fd.set('file', input);
                void run(
                  () => api(`${base}/verification/documents`, { form: fd, method: 'POST' }),
                  'Document uploaded',
                );
                e.currentTarget.reset();
              }}
            >
              <select
                aria-label="Document type"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                style={{ maxWidth: 260 }}
              >
                {DOC_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                aria-label="Document file"
              />
              <button className="btn btn-secondary btn-sm">Upload</button>
            </form>
          )}
        </Section>
      </div>
      <aside className="card stack-sm" style={{ position: 'sticky', top: 120 }}>
        <h2 style={{ fontSize: '1rem' }}>Verification checklist</h2>
        {!r ? (
          <Loading />
        ) : (
          <>
            <p className="small mb-0">
              Pathway: <strong>{r.pathway.replace(/_/g, ' ').toLowerCase()}</strong>
            </p>
            <ul className="small" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {r.checklist.map((c) => (
                <li key={c.key} style={{ padding: '4px 0' }}>
                  {c.done ? '✅' : '⬜'} {c.label}
                </li>
              ))}
            </ul>
            {m.status === 'APPROVED' ? (
              <Alert tone="success">Your store is approved.</Alert>
            ) : m.status === 'PENDING_REVIEW' ? (
              <Alert tone="info">Submitted — under review.</Alert>
            ) : (
              <button
                className="btn btn-amber btn-block"
                disabled={!r.canSubmit || m.myRole !== 'OWNER'}
                onClick={() =>
                  run(
                    () => api(`${base}/verification/submit`, { method: 'POST' }),
                    'Submitted for review',
                  )
                }
              >
                Submit for review
              </button>
            )}
            <p className="meta mb-0">
              Verification confirms your identity to customers. It is not an endorsement of your
              products.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
