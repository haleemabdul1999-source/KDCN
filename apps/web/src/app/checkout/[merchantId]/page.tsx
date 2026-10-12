'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Loading } from '@/components/ui';
import { api, ApiError, newIdempotencyKey, saveOrderToken, track } from '@/lib/api';
import { FULFILMENT_LABEL, naira } from '@/lib/format';

interface Options {
  options: {
    method: string;
    feeMinor: number;
    instructions: string;
    collectionPoint: {
      id: string;
      name: string;
      publicAddress: string;
      openingHours: string;
    } | null;
  }[];
  deliveryAreas: {
    deliveryFeeMinor: number;
    etaDays: number;
    area: { id: string; name: string };
  }[];
  storeLocations: { label: string; publicAddress: string | null; unitLabel: string | null }[];
}
interface Quote {
  merchant: { displayName: string };
  lines: {
    listingVariantId: string;
    title: string;
    variantName: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    stockMode: string;
  }[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  totalMinor: number;
  requiresConfirmation: boolean;
  maxLeadTimeDays: number;
  terms: { cancellationPolicy: string; returnPolicy: string; platform: string };
}

export default function CheckoutPage() {
  const { merchantId } = useParams<{ merchantId: string }>();
  const router = useRouter();
  const { me, refreshCart } = useAuth();
  const [opts, setOpts] = useState<Options | null>(null);
  const [choice, setChoice] = useState<string>(''); // method or method:collectionPointId
  const [areaId, setAreaId] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [guest, setGuest] = useState({ name: '', email: '', phone: '' });
  const [accept, setAccept] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const idemKey = useMemo(() => newIdempotencyKey(), []);

  const [method, collectionPointId] = choice.split(':');
  const isDelivery = method === 'MERCHANT_DELIVERY' || method === 'THIRD_PARTY_DELIVERY';

  useEffect(() => {
    api<Options>('/checkout/quote', { body: { merchantId } })
      .then((o) => {
        setOpts(o);
        const first = o.options[0];
        if (first)
          setChoice(
            first.collectionPoint ? `${first.method}:${first.collectionPoint.id}` : first.method,
          );
      })
      .catch((e) => setError(e.message));
    track('CHECKOUT_STARTED');
  }, [merchantId]);

  useEffect(() => {
    if (!method || (isDelivery && !areaId)) {
      setQuote(null);
      return;
    }
    api<Quote>('/checkout/quote', {
      body: {
        merchantId,
        fulfilmentMethod: method,
        collectionPointId: collectionPointId || undefined,
        deliveryAreaId: isDelivery ? areaId : undefined,
      },
    })
      .then((q) => {
        setQuote(q);
        setError(null);
      })
      .catch((e) => {
        setQuote(null);
        setError(e instanceof ApiError ? e.message : 'Could not calculate your total');
      });
  }, [merchantId, method, collectionPointId, areaId, isDelivery]);

  if (!opts && !error) return <Loading label="Preparing checkout" />;

  const place = async () => {
    setPlacing(true);
    setError(null);
    try {
      const res = await api<{ order: { id: string }; guestAccessToken?: string }>(
        '/checkout/place',
        {
          headers: { 'Idempotency-Key': idemKey },
          body: {
            merchantId,
            fulfilmentMethod: method,
            collectionPointId: collectionPointId || undefined,
            deliveryAreaId: isDelivery ? areaId : undefined,
            deliveryAddress: isDelivery ? address : undefined,
            recipientPhone: phone || undefined,
            customerNote: note || undefined,
            acceptTerms: accept,
            ...(me
              ? {}
              : { guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone }),
          },
        },
      );
      if (res.guestAccessToken) saveOrderToken(res.order.id, res.guestAccessToken);
      await refreshCart();
      router.push(
        `/orders/${res.order.id}${res.guestAccessToken ? `?token=${encodeURIComponent(res.guestAccessToken)}` : ''}`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not place your order');
      setPlacing(false);
    }
  };

  return (
    <div className="grid-main-side">
      <div className="stack">
        <h1>Checkout{quote ? ` — ${quote.merchant.displayName}` : ''}</h1>
        {error && <Alert tone="error">{error}</Alert>}
        {!me && (
          <section className="card">
            <h2>Your details</h2>
            <p className="small muted">
              <Link href={`/login?next=/checkout/${merchantId}`}>Sign in</Link> to track orders in
              your account, or continue as a guest.
            </p>
            <div className="field">
              <label htmlFor="g-name">Full name</label>
              <input
                id="g-name"
                required
                value={guest.name}
                onChange={(e) => setGuest({ ...guest, name: e.target.value })}
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="g-email">Email (for receipts)</label>
                <input
                  id="g-email"
                  type="email"
                  required
                  value={guest.email}
                  onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="g-phone">Phone</label>
                <input
                  id="g-phone"
                  type="tel"
                  required
                  value={guest.phone}
                  onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                />
              </div>
            </div>
          </section>
        )}
        <section className="card">
          <h2>How would you like to get your order?</h2>
          {opts?.options.length === 0 && (
            <Alert tone="warn">This seller has not set up delivery or collection yet.</Alert>
          )}
          <div role="radiogroup" aria-label="Delivery or collection">
            {opts?.options.map((o) => {
              const value = o.collectionPoint ? `${o.method}:${o.collectionPoint.id}` : o.method;
              return (
                <label key={value} className="radio-card">
                  <input
                    type="radio"
                    name="fulfilment"
                    value={value}
                    checked={choice === value}
                    onChange={() => setChoice(value)}
                  />
                  <span>
                    <strong>{FULFILMENT_LABEL[o.method]}</strong>
                    {o.collectionPoint && (
                      <span className="meta" style={{ display: 'block' }}>
                        {o.collectionPoint.name} — {o.collectionPoint.publicAddress}{' '}
                        {o.collectionPoint.openingHours && `(${o.collectionPoint.openingHours})`}
                      </span>
                    )}
                    {o.method === 'IN_STORE_COLLECTION' &&
                      opts.storeLocations.map((l) => (
                        <span key={l.label} className="meta" style={{ display: 'block' }}>
                          {l.label}: {l.publicAddress}
                        </span>
                      ))}
                    {o.method === 'MERCHANT_DELIVERY' && (
                      <span className="meta" style={{ display: 'block' }}>
                        Fee depends on your area
                      </span>
                    )}
                    {o.method !== 'MERCHANT_DELIVERY' && o.feeMinor > 0 && (
                      <span className="meta" style={{ display: 'block' }}>
                        {naira(o.feeMinor)}
                      </span>
                    )}
                    {o.instructions && (
                      <span className="meta" style={{ display: 'block' }}>
                        {o.instructions}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {isDelivery && (
            <div className="stack-sm" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="area">Delivery area</label>
                <select
                  id="area"
                  value={areaId}
                  onChange={(e) => setAreaId(e.target.value)}
                  required
                >
                  <option value="">Choose your area</option>
                  {opts?.deliveryAreas.map((a) => (
                    <option key={a.area.id} value={a.area.id}>
                      {a.area.name} — {naira(a.deliveryFeeMinor)}
                      {a.etaDays ? ` (about ${a.etaDays} day${a.etaDays > 1 ? 's' : ''})` : ''}
                    </option>
                  ))}
                </select>
                {method === 'MERCHANT_DELIVERY' && opts?.deliveryAreas.length === 0 && (
                  <div className="error">This seller has no delivery areas configured.</div>
                )}
              </div>
              <div className="field">
                <label htmlFor="addr">Delivery address</label>
                <textarea
                  id="addr"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="House number, street, landmark"
                  required
                />
                <div className="hint">Shared with the seller and courier only after you pay.</div>
              </div>
            </div>
          )}
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="phone">Contact phone for this order {me ? '(optional)' : ''}</label>
            <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="note">Note to seller (optional)</label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
        </section>
      </div>
      <aside className="card stack" aria-live="polite">
        <h2>Order summary</h2>
        {!quote ? (
          <p className="muted small">
            {isDelivery && !areaId ? 'Choose a delivery area to see your total.' : 'Calculating…'}
          </p>
        ) : (
          <>
            {quote.lines.map((l) => (
              <div key={l.listingVariantId} className="summary-line small">
                <span>
                  {l.quantity} × {l.title} <span className="meta">({l.variantName})</span>
                </span>
                <span>{naira(l.lineTotalMinor)}</span>
              </div>
            ))}
            <div>
              <div className="summary-line">
                <span>Subtotal</span>
                <span>{naira(quote.subtotalMinor)}</span>
              </div>
              <div className="summary-line">
                <span>Delivery / collection</span>
                <span>{quote.deliveryFeeMinor ? naira(quote.deliveryFeeMinor) : 'Free'}</span>
              </div>
              <div className="summary-line">
                <span>KDCN service fee</span>
                <span>{naira(quote.serviceFeeMinor)}</span>
              </div>
              <div className="summary-line summary-total">
                <span>Total</span>
                <span>{naira(quote.totalMinor)}</span>
              </div>
            </div>
            {quote.requiresConfirmation ? (
              <Alert tone="info">
                The seller will confirm availability first. You&apos;ll be asked to pay only after
                they confirm — nothing is charged now.
              </Alert>
            ) : (
              <Alert tone="info">
                All items are in stock. You&apos;ll pay securely on the next step.
              </Alert>
            )}
            {quote.maxLeadTimeDays > 0 && (
              <p className="small">
                Made-to-order items take about {quote.maxLeadTimeDays} day(s) to prepare after
                payment.
              </p>
            )}
            <details>
              <summary>Refund &amp; cancellation terms</summary>
              <p className="small">{quote.terms.platform}</p>
              {quote.terms.cancellationPolicy && (
                <p className="small">
                  <strong>Seller cancellation policy:</strong> {quote.terms.cancellationPolicy}
                </p>
              )}
              {quote.terms.returnPolicy && (
                <p className="small">
                  <strong>Seller return policy:</strong> {quote.terms.returnPolicy}
                </p>
              )}
            </details>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={accept}
                onChange={(e) => setAccept(e.target.checked)}
              />{' '}
              I accept the refund and cancellation terms
            </label>
            <button
              className="btn btn-amber btn-block"
              disabled={
                !accept ||
                placing ||
                (isDelivery && address.trim().length < 5) ||
                (!me && (!guest.email || !guest.phone))
              }
              onClick={place}
            >
              {placing
                ? 'Placing order…'
                : quote.requiresConfirmation
                  ? 'Place order (pay after confirmation)'
                  : 'Place order & continue to payment'}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
