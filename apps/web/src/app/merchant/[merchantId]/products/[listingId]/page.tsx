'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ListingForm, type ListingData } from '@/components/ListingForm';
import { useMerchant } from '@/components/MerchantContext';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';

export default function EditProduct() {
  const { m } = useMerchant();
  const { listingId } = useParams<{ listingId: string }>();
  const path = `/merchant/${m.id}/listings/${listingId}`;
  const { data: l, setData, error, loading } = useApi<ListingData & { slug: string }>(path);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  if (loading) return <Loading />;
  if (error || !l) return <Alert tone="error">{error?.message ?? 'Not found'}</Alert>;
  const act = async (fn: () => Promise<ListingData & { slug: string }>, ok: string) => {
    try {
      setData(await fn());
      setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiError ? e.message : 'Failed' });
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row-between">
        <h2 className="mb-0">
          {l.product.title} <StatusBadge status={l.status} />
        </h2>
        <div className="row">
          {l.status === 'ACTIVE' && (
            <>
              <Link href={`/p/${l.slug}`} className="btn btn-secondary btn-sm">
                View live
              </Link>
              <button className="btn btn-secondary btn-sm" onClick={() => act(() => api(`${path}/status`, { body: { status: 'PAUSED' } }), 'Product paused')}>
                Pause
              </button>
            </>
          )}
          {(l.status === 'PAUSED' || l.status === 'DRAFT') && (
            <button className="btn btn-sm" onClick={() => act(() => api(`${path}/status`, { body: { status: 'ACTIVE' } }), 'Product published')}>
              Publish
            </button>
          )}
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {l.status === 'BLOCKED' && <Alert tone="error">This product was removed by KDCN moderation and cannot be edited.</Alert>}
      {l.product.moderationStatus === 'PENDING_REVIEW' && <Alert tone="warn">Awaiting KDCN review (restricted category). It will appear to customers once approved.</Alert>}
      {l.product.moderationStatus === 'REJECTED' && <Alert tone="error">Not approved by KDCN: {l.product.moderationNote}</Alert>}
      {m.status !== 'APPROVED' && <Alert tone="info">Products go live once your store is approved.</Alert>}
      <section className="card stack-sm">
        <h3>Photos</h3>
        <div className="row">
          {l.product.images.map((img) => (
            <div key={img.id} className="stack-sm" style={{ width: 110 }}>
              <img src={img.url} alt={img.alt} width={110} height={110} style={{ objectFit: 'cover', borderRadius: 8, width: 110, height: 110 }} />
              <button className="btn btn-link small" onClick={() => act(() => api(`${path}/images/${img.id}`, { method: 'DELETE' }), 'Photo removed')}>
                Remove
              </button>
            </div>
          ))}
        </div>
        {l.product.images.length < 8 && (
          <label className="btn btn-secondary btn-sm" style={{ width: 'fit-content' }}>
            {uploading ? 'Uploading…' : '+ Add photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                const fd = new FormData();
                fd.set('file', file);
                fd.set('alt', l.product.title);
                await act(() => api(`${path}/images`, { method: 'POST', form: fd }), 'Photo added');
                setUploading(false);
              }}
            />
          </label>
        )}
        <p className="meta mb-0">Location data (GPS) is removed from photos automatically.</p>
      </section>
      {l.status !== 'BLOCKED' && <ListingForm merchantId={m.id} merchantType={m.type} existing={l} onSaved={(x) => (setData(x as ListingData & { slug: string }), setMsg({ tone: 'success', text: 'Saved' }))} />}
      {l.status !== 'REMOVED' && l.status !== 'BLOCKED' && (
        <button className="btn btn-link" style={{ color: 'var(--red-700)' }} onClick={() => confirm('Remove this product from your store?') && act(() => api(`${path}/status`, { body: { status: 'REMOVED' } }), 'Product removed')}>
          Remove product
        </button>
      )}
    </div>
  );
}
