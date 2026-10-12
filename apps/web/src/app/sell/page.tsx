'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

interface City {
  name: string;
  areas: { id: string; name: string }[];
}

const TYPES = [
  {
    value: 'HOME_VENDOR',
    title: 'I sell from home',
    text: 'Home bakers, fashion designers, cosmetics, crafts. Your address stays private.',
  },
  {
    value: 'MALL_RETAILER',
    title: 'I have a shop in a mall',
    text: 'For example Galaxy Mall. Offer in-store collection.',
  },
  {
    value: 'MARKET_TRADER',
    title: 'I trade in a market',
    text: 'Kaduna Central Market and other traditional markets.',
  },
  {
    value: 'INDEPENDENT_SHOP',
    title: 'I have a standalone shop',
    text: 'A shop, workshop or warehouse outside a mall or market.',
  },
];

export default function SellPage() {
  const { me, loading, refresh } = useAuth();
  const router = useRouter();
  const [cities, setCities] = useState<City[]>([]);
  const [form, setForm] = useState({
    type: 'HOME_VENDOR',
    displayName: '',
    description: '',
    contactEmail: '',
    contactPhone: '',
    publicAreaId: '',
    cacNumber: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    api<City[]>('/geo/cities')
      .then(setCities)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (me) setForm((f) => ({ ...f, contactEmail: f.contactEmail || me.email }));
  }, [me]);

  if (loading) return <Loading />;
  return (
    <div className="grid-main-side">
      <div className="stack">
        <section className="hero">
          <h1>Sell on KDCN</h1>
          <p>
            Reach customers across Kaduna with your own online storefront. Share it on WhatsApp and
            Instagram, take secure payments, and arrange delivery or collection — whether you sell
            from Galaxy Mall, a market stall, a shop or your home.
          </p>
        </section>
        {!me ? (
          <Alert tone="info">
            <Link href="/register?next=/sell">Create an account</Link> or{' '}
            <Link href="/login?next=/sell">sign in</Link> to register your store. It takes about 10
            minutes.
          </Alert>
        ) : (
          <form
            className="card"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(null);
              setErrors({});
              try {
                const m = await api<{ id: string }>('/merchants', {
                  body: {
                    ...form,
                    cacNumber: form.cacNumber || undefined,
                    description: form.description || undefined,
                  },
                });
                await refresh();
                router.push(`/merchant/${m.id}/onboarding`);
              } catch (err) {
                if (err instanceof ApiError) {
                  setErrors(err.fieldErrors());
                  setError(err.message);
                }
                setPending(false);
              }
            }}
          >
            <h2>Tell us about your business</h2>
            {error && <Alert tone="error">{error}</Alert>}
            <fieldset>
              <legend>How do you sell?</legend>
              {TYPES.map((t) => (
                <label key={t.value} className="radio-card">
                  <input
                    type="radio"
                    name="type"
                    value={t.value}
                    checked={form.type === t.value}
                    onChange={() => setForm({ ...form, type: t.value })}
                  />
                  <span>
                    <strong>{t.title}</strong>
                    <span className="meta" style={{ display: 'block' }}>
                      {t.text}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="dn">Business name (shown to customers)</label>
              <input
                id="dn"
                required
                minLength={2}
                maxLength={80}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
              {errors.displayName && <div className="error">{errors.displayName}</div>}
            </div>
            <div className="field">
              <label htmlFor="desc">Short description</label>
              <textarea
                id="desc"
                maxLength={2000}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What do you sell? What makes you special?"
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="ce">Business email</label>
                <input
                  id="ce"
                  type="email"
                  required
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="cph">Business phone</label>
                <input
                  id="cph"
                  type="tel"
                  required
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                />
                {errors.contactPhone && <div className="error">{errors.contactPhone}</div>}
              </div>
            </div>
            <div className="field">
              <label htmlFor="area">General area (shown publicly)</label>
              <select
                id="area"
                required
                value={form.publicAreaId}
                onChange={(e) => setForm({ ...form, publicAreaId: e.target.value })}
              >
                <option value="">Choose your area</option>
                {cities.map((c) => (
                  <optgroup key={c.name} label={c.name}>
                    {c.areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="hint">
                Only the neighbourhood name is shown — never your street address.
              </div>
            </div>
            {form.type !== 'HOME_VENDOR' && (
              <div className="field">
                <label htmlFor="cac">CAC registration number (if registered)</label>
                <input
                  id="cac"
                  placeholder="RC123456 or BN1234567"
                  value={form.cacNumber}
                  onChange={(e) => setForm({ ...form, cacNumber: e.target.value })}
                />
                {errors.cacNumber && <div className="error">{errors.cacNumber}</div>}
              </div>
            )}
            <button className="btn btn-amber" disabled={pending}>
              {pending ? 'Creating…' : 'Continue to verification'}
            </button>
          </form>
        )}
      </div>
      <aside className="card stack-sm">
        <h2 style={{ fontSize: '1rem' }}>What you&apos;ll need</h2>
        <ul className="small" style={{ paddingLeft: 18 }}>
          <li>A government-issued photo ID</li>
          <li>Your bank account for payouts</li>
          <li>Mall/market traders: shop allocation or tenancy letter</li>
          <li>Registered businesses: CAC certificate</li>
          <li>Food &amp; cosmetics home vendors: extra checks may apply</li>
        </ul>
        <p className="small muted">
          KDCN charges a small commission on each completed sale. There is no listing fee.
        </p>
      </aside>
    </div>
  );
}
