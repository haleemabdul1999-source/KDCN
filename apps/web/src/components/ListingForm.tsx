'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from './ui';

interface Category {
  id: string;
  name: string;
  homeVendorPolicy: string;
  children: { id: string; name: string; homeVendorPolicy: string }[];
}

export interface ListingData {
  id: string;
  status: string;
  stockMode: string;
  leadTimeDays: number;
  minOrderQty: number;
  maxOrderQty: number;
  returnPolicy: string | null;
  product: {
    title: string;
    description: string;
    brand: string | null;
    category: { id: string };
    moderationStatus: string;
    moderationNote: string | null;
    images: { id: string; url: string; alt: string }[];
  };
  variants: {
    id: string;
    name: string;
    priceMinor: number;
    compareAtMinor: number | null;
    quantity: number;
    reserved: number;
    active: boolean;
  }[];
}

interface VariantRow {
  id?: string;
  name: string;
  price: string;
  compareAt: string;
  quantity: string;
  active: boolean;
}

/** Create/edit a product listing. Simple by default: one price, optional extra options. */
export function ListingForm({
  merchantId,
  merchantType,
  existing,
  onSaved,
}: {
  merchantId: string;
  merchantType: string;
  existing?: ListingData;
  onSaved?: (l: ListingData) => void;
}) {
  const router = useRouter();
  const [cats, setCats] = useState<Category[]>([]);
  const [f, setF] = useState({
    title: existing?.product.title ?? '',
    description: existing?.product.description ?? '',
    brand: existing?.product.brand ?? '',
    categoryId: existing?.product.category.id ?? '',
    stockMode:
      existing?.stockMode ??
      (merchantType === 'HOME_VENDOR' ? 'MADE_TO_ORDER' : 'CONFIRM_ON_ORDER'),
    leadTimeDays: String(existing?.leadTimeDays ?? 0),
    minOrderQty: String(existing?.minOrderQty ?? 1),
    maxOrderQty: String(existing?.maxOrderQty ?? 20),
    returnPolicy: existing?.returnPolicy ?? '',
  });
  const [variants, setVariants] = useState<VariantRow[]>(
    existing?.variants
      .filter((v) => v.active)
      .map((v) => ({
        id: v.id,
        name: v.name,
        price: String(v.priceMinor / 100),
        compareAt: v.compareAtMinor ? String(v.compareAtMinor / 100) : '',
        quantity: String(v.quantity),
        active: v.active,
      })) ?? [{ name: 'Standard', price: '', compareAt: '', quantity: '0', active: true }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Category[]>('/categories')
      .then(setCats)
      .catch(() => undefined);
  }, []);

  const save = async (publish: boolean) => {
    setSaving(true);
    setError(null);
    setErrors({});
    const body = {
      title: f.title,
      description: f.description,
      brand: f.brand || undefined,
      categoryId: f.categoryId,
      stockMode: f.stockMode,
      leadTimeDays: Number(f.leadTimeDays),
      minOrderQty: Number(f.minOrderQty),
      maxOrderQty: Number(f.maxOrderQty),
      returnPolicy: f.returnPolicy || null,
      variants: variants.map((v) => ({
        id: v.id,
        name: v.name || 'Standard',
        priceMinor: Math.round(Number(v.price) * 100),
        compareAtMinor: v.compareAt ? Math.round(Number(v.compareAt) * 100) : null,
        quantity: f.stockMode === 'TRACKED' ? Number(v.quantity) : undefined,
        active: true,
      })),
      ...(existing ? {} : { publish }),
    };
    try {
      const l = existing
        ? await api<ListingData>(`/merchant/${merchantId}/listings/${existing.id}`, {
            method: 'PATCH',
            body,
          })
        : await api<ListingData>(`/merchant/${merchantId}/listings`, { body });
      if (existing && publish && l.status !== 'ACTIVE')
        await api(`/merchant/${merchantId}/listings/${l.id}/status`, {
          body: { status: 'ACTIVE' },
        });
      if (onSaved) onSaved(l);
      else router.push(`/merchant/${merchantId}/products/${l.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        setError(e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const selected = cats.flatMap((c) => [c, ...c.children]).find((c) => c.id === f.categoryId);
  return (
    <form className="card stack-sm" onSubmit={(e) => (e.preventDefault(), save(true))}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="field">
        <label htmlFor="t">Product name</label>
        <input
          id="t"
          type="text"
          required
          minLength={3}
          maxLength={120}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        {errors.title && <div className="error">{errors.title}</div>}
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="cat">Category</label>
          <select
            id="cat"
            required
            value={f.categoryId}
            onChange={(e) => setF({ ...f, categoryId: e.target.value })}
          >
            <option value="">Choose a category</option>
            {cats.map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name} (general)</option>
                {c.children.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {merchantType === 'HOME_VENDOR' && selected?.homeVendorPolicy === 'ENHANCED_REVIEW' && (
            <div className="hint">
              This category needs a KDCN check before going live for home vendors.
            </div>
          )}
          {merchantType === 'HOME_VENDOR' && selected?.homeVendorPolicy === 'PROHIBITED' && (
            <div className="error">Home vendors can&apos;t sell in this category.</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="b">Brand (optional)</label>
          <input
            id="b"
            type="text"
            value={f.brand}
            onChange={(e) => setF({ ...f, brand: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="d">Description</label>
        <textarea
          id="d"
          maxLength={5000}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Size, material, what's included, care instructions…"
        />
      </div>
      <fieldset>
        <legend>Availability</legend>
        {[
          ['TRACKED', 'I keep a stock count', 'Customers can pay straight away while stock lasts.'],
          [
            'CONFIRM_ON_ORDER',
            'I confirm each order',
            'You confirm availability before the customer pays.',
          ],
          [
            'MADE_TO_ORDER',
            'Made to order',
            'You make it after the order. Set your preparation time.',
          ],
        ].map(([v, t, h]) => (
          <label key={v} className="radio-card">
            <input
              type="radio"
              name="stockMode"
              value={v}
              checked={f.stockMode === v}
              onChange={() => setF({ ...f, stockMode: v })}
            />
            <span>
              <strong>{t}</strong>
              <span className="meta" style={{ display: 'block' }}>
                {h}
              </span>
            </span>
          </label>
        ))}
        {f.stockMode === 'MADE_TO_ORDER' && (
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="lead">Preparation time (days)</label>
            <input
              id="lead"
              type="number"
              min={0}
              max={90}
              value={f.leadTimeDays}
              onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })}
            />
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend>Price &amp; options</legend>
        {variants.map((v, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            {variants.length > 1 || v.name !== 'Standard' ? (
              <div className="field" style={{ flex: '1 1 140px' }}>
                <label htmlFor={`vn${i}`}>Option name</label>
                <input
                  id={`vn${i}`}
                  type="text"
                  value={v.name}
                  onChange={(e) =>
                    setVariants(
                      variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="e.g. Size M / Red"
                />
              </div>
            ) : null}
            <div className="field" style={{ flex: '1 1 120px' }}>
              <label htmlFor={`vp${i}`}>Price (₦)</label>
              <input
                id={`vp${i}`}
                type="number"
                min={1}
                step="0.01"
                required
                value={v.price}
                onChange={(e) =>
                  setVariants(
                    variants.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)),
                  )
                }
              />
            </div>
            <div className="field" style={{ flex: '1 1 120px' }}>
              <label htmlFor={`vc${i}`}>Was (₦, optional)</label>
              <input
                id={`vc${i}`}
                type="number"
                min={0}
                step="0.01"
                value={v.compareAt}
                onChange={(e) =>
                  setVariants(
                    variants.map((x, j) => (j === i ? { ...x, compareAt: e.target.value } : x)),
                  )
                }
              />
            </div>
            {f.stockMode === 'TRACKED' && (
              <div className="field" style={{ flex: '1 1 100px' }}>
                <label htmlFor={`vq${i}`}>In stock</label>
                <input
                  id={`vq${i}`}
                  type="number"
                  min={0}
                  value={v.quantity}
                  onChange={(e) =>
                    setVariants(
                      variants.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                    )
                  }
                />
              </div>
            )}
            {variants.length > 1 && (
              <button
                type="button"
                className="btn btn-link field"
                onClick={() => setVariants(variants.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() =>
            setVariants([
              ...variants,
              { name: '', price: '', compareAt: '', quantity: '0', active: true },
            ])
          }
        >
          + Add size / colour option
        </button>
      </fieldset>
      <details>
        <summary>More settings</summary>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="min">Minimum order quantity</label>
            <input
              id="min"
              type="number"
              min={1}
              value={f.minOrderQty}
              onChange={(e) => setF({ ...f, minOrderQty: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="max">Maximum per order</label>
            <input
              id="max"
              type="number"
              min={1}
              value={f.maxOrderQty}
              onChange={(e) => setF({ ...f, maxOrderQty: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="rp">Return policy for this product (optional)</label>
          <textarea
            id="rp"
            value={f.returnPolicy}
            onChange={(e) => setF({ ...f, returnPolicy: e.target.value })}
            placeholder="Leave empty to use your store policy"
          />
        </div>
      </details>
      <div className="row">
        <button className="btn" disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save & publish' : 'Publish product'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving}
          onClick={() => save(false)}
        >
          {existing ? 'Save changes' : 'Save as draft'}
        </button>
      </div>
    </form>
  );
}
