'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { naira } from '@/lib/format';
import type { Availability } from '@/lib/types';
import { useAuth } from './AuthProvider';
import { Alert, AvailabilityBadge } from './ui';

interface Variant {
  id: string;
  name: string;
  priceMinor: number;
  compareAtMinor: number | null;
  availability: Availability;
}

export function AddToCart({ variants, minQty, maxQty, requiresConfirmation }: { variants: Variant[]; minQty: number; maxQty: number; requiresConfirmation: boolean }) {
  const firstAvailable = variants.find((v) => v.availability.purchasable) ?? variants[0];
  const [variantId, setVariantId] = useState(firstAvailable?.id);
  const [qty, setQty] = useState(minQty);
  const [state, setState] = useState<'idle' | 'adding' | 'added'>('idle');
  const [error, setError] = useState<string | null>(null);
  const { refreshCart } = useAuth();
  const v = variants.find((x) => x.id === variantId) ?? firstAvailable;
  if (!v) return <Alert tone="warn">This product has no available options.</Alert>;

  return (
    <div className="stack">
      <div>
        <span className="price" style={{ fontSize: '1.6rem' }}>
          {naira(v.priceMinor)}
        </span>
        {v.compareAtMinor && <span className="price-was">{naira(v.compareAtMinor)}</span>}
      </div>
      <AvailabilityBadge a={v.availability} />
      {variants.length > 1 && (
        <fieldset>
          <legend>Option</legend>
          {variants.map((x) => (
            <label key={x.id} className="radio-card">
              <input type="radio" name="variant" value={x.id} checked={x.id === v.id} onChange={() => setVariantId(x.id)} disabled={!x.availability.purchasable} />
              <span>
                {x.name} — {naira(x.priceMinor)} <span className="meta">({x.availability.label})</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="field" style={{ maxWidth: 160 }}>
        <label htmlFor="qty">Quantity</label>
        <input id="qty" type="number" min={minQty} max={maxQty} value={qty} onChange={(e) => setQty(Math.max(minQty, Math.min(maxQty, Number(e.target.value) || minQty)))} />
        {minQty > 1 && <div className="hint">Minimum order: {minQty}</div>}
      </div>
      {requiresConfirmation && <Alert tone="info">The seller confirms availability after you order. You only pay once they confirm.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="sticky-cta row">
        <button
          className="btn btn-amber"
          style={{ flex: 1 }}
          disabled={!v.availability.purchasable || state === 'adding'}
          onClick={async () => {
            setState('adding');
            setError(null);
            try {
              await api('/cart/items', { body: { listingVariantId: v.id, quantity: qty } });
              await refreshCart();
              setState('added');
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Could not add to cart');
              setState('idle');
            }
          }}
        >
          {!v.availability.purchasable ? 'Out of stock' : state === 'adding' ? 'Adding…' : 'Add to cart'}
        </button>
        {state === 'added' && (
          <Link href="/cart" className="btn btn-secondary">
            View cart →
          </Link>
        )}
      </div>
      {state === 'added' && <p className="small" role="status">Added to your cart.</p>}
    </div>
  );
}

export function ShareButtons({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
  return (
    <div className="row">
      <a className="btn btn-secondary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`} target="_blank" rel="noopener noreferrer">
        Share on WhatsApp
      </a>
      <button
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Link copied' : 'Copy link (for Instagram bio)'}
      </button>
    </div>
  );
}

export function EnquiryForm({ merchantSlug, listingId }: { merchantSlug: string; listingId?: string }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  if (!me) return <p className="small"><Link href="/login">Sign in</Link> to ask the seller a question.</p>;
  if (!open) return <button className="btn btn-link" onClick={() => setOpen(true)}>Ask the seller a question</button>;
  if (status === 'sent') return <Alert tone="success">Question sent. You&apos;ll see the reply in your account.</Alert>;
  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setStatus('sending');
        try {
          await api('/enquiries', { body: { merchantSlug, listingId, message: msg } });
          setStatus('sent');
        } catch {
          setStatus('error');
        }
      }}
    >
      <label htmlFor="enq">Your question</label>
      <textarea id="enq" value={msg} onChange={(e) => setMsg(e.target.value)} minLength={5} maxLength={2000} required />
      {status === 'error' && <Alert tone="error">Could not send your question.</Alert>}
      <button className="btn btn-secondary btn-sm" disabled={status === 'sending'}>
        Send question
      </button>
    </form>
  );
}

export function ReportLink({ targetType, targetId }: { targetType: 'LISTING' | 'MERCHANT'; targetId: string }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState('misleading');
  const [details, setDetails] = useState('');
  if (!me) return null;
  if (done) return <p className="small muted">Thank you — our team will review this report.</p>;
  if (!open)
    return (
      <button className="btn btn-link small muted" onClick={() => setOpen(true)}>
        Report this {targetType === 'LISTING' ? 'product' : 'seller'}
      </button>
    );
  return (
    <form
      className="stack-sm card"
      onSubmit={async (e) => {
        e.preventDefault();
        await api('/reports', { body: { targetType, targetId, reason, details } }).catch(() => undefined);
        setDone(true);
      }}
    >
      <label htmlFor="rep-reason">Reason</label>
      <select id="rep-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="counterfeit">Counterfeit</option>
        <option value="prohibited_item">Prohibited item</option>
        <option value="fraud">Suspected fraud</option>
        <option value="misleading">Misleading information</option>
        <option value="offensive">Offensive content</option>
        <option value="other">Other</option>
      </select>
      <label htmlFor="rep-details">Details (optional)</label>
      <textarea id="rep-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} />
      <button className="btn btn-secondary btn-sm">Submit report</button>
    </form>
  );
}
