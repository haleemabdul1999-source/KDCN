import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCart, EnquiryForm, ReportLink, ShareButtons } from '@/components/AddToCart';
import { ViewTracker } from '@/components/Trackers';
import { Stars, VerifiedBadge } from '@/components/ui';
import { FULFILMENT_LABEL, initials, MERCHANT_TYPE_LABEL, naira } from '@/lib/format';
import { serverGet } from '@/lib/server';
import type { Availability, PublicMerchant } from '@/lib/types';

export const revalidate = 15;

interface Listing {
  id: string;
  slug: string;
  title: string;
  description: string;
  brand: string | null;
  attributes: Record<string, string>;
  category: { slug: string; name: string; parent: { slug: string; name: string } | null };
  images: { url: string; alt: string }[];
  stockMode: string;
  leadTimeDays: number;
  minOrderQty: number;
  maxOrderQty: number;
  returnPolicy: string;
  cancellationPolicy: string;
  requiresConfirmation: boolean;
  variants: {
    id: string;
    name: string;
    priceMinor: number;
    compareAtMinor: number | null;
    availability: Availability;
  }[];
  merchant: PublicMerchant & { rating: { average: number | null; count: number } };
  fulfilment: {
    options: {
      method: string;
      feeMinor: number;
      instructions: string;
      collectionPoint: { name: string; publicAddress: string; openingHours: string } | null;
    }[];
    deliveryAreas: { name: string; feeMinor: number; etaDays: number }[];
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const l = await serverGet<Listing>(`/listings/${(await params).slug}`);
  return l
    ? {
        title: l.title,
        description: l.description.slice(0, 160),
        openGraph: { title: l.title, images: l.images.slice(0, 1).map((i) => i.url) },
      }
    : {};
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const l = await serverGet<Listing>(`/listings/${(await params).slug}`);
  if (!l) notFound();
  const m = l.merchant;
  return (
    <div className="stack">
      <ViewTracker type="PRODUCT_VIEW" listingId={l.id} />
      <nav className="small muted" aria-label="Breadcrumb">
        <Link href="/">Home</Link> ›{' '}
        {l.category.parent && (
          <>
            <Link href={`/search?category=${l.category.parent.slug}`}>
              {l.category.parent.name}
            </Link>{' '}
            ›{' '}
          </>
        )}
        <Link href={`/search?category=${l.category.slug}`}>{l.category.name}</Link>
      </nav>
      <div className="grid-2">
        <div className="stack-sm">
          <div className="gallery-main">
            {l.images[0] ? (
              <img src={l.images[0].url} alt={l.images[0].alt} width={600} height={600} />
            ) : (
              <span className="thumb-placeholder">{initials(l.title)}</span>
            )}
          </div>
          {l.images.length > 1 && (
            <div className="scroll-x">
              {l.images.slice(1).map((img) => (
                <img
                  key={img.url}
                  src={img.url}
                  alt={img.alt}
                  width={88}
                  height={88}
                  loading="lazy"
                  style={{ borderRadius: 8, objectFit: 'cover', width: 88, height: 88 }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="stack">
          <div>
            <h1 style={{ marginBottom: 4 }}>{l.title}</h1>
            {l.brand && <div className="muted">Brand: {l.brand}</div>}
          </div>
          <AddToCart
            variants={l.variants}
            minQty={l.minOrderQty}
            maxQty={l.maxOrderQty}
            requiresConfirmation={l.requiresConfirmation}
          />
          <div className="card-flat">
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <div className="avatar">
                {m.logoUrl ? <img src={m.logoUrl} alt="" /> : initials(m.displayName)}
              </div>
              <div className="stack-sm" style={{ minWidth: 0 }}>
                <Link href={`/s/${m.slug}`} style={{ fontWeight: 700 }}>
                  {m.displayName}
                </Link>
                <div className="meta">
                  {MERCHANT_TYPE_LABEL[m.type]}
                  {m.markets[0]
                    ? ` · ${m.markets[0].name}${m.markets[0].unitLabel ? ` (${m.markets[0].unitLabel})` : ''}`
                    : m.publicAreaLabel
                      ? ` · ${m.publicAreaLabel}`
                      : ''}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <VerifiedBadge
                    verified={m.verification.status === 'IDENTITY_VERIFIED'}
                    withHint
                  />
                  <Stars value={m.rating.average} />
                  {m.rating.count > 0 && <span className="meta">({m.rating.count})</span>}
                </div>
              </div>
            </div>
            {m.verification.status === 'IDENTITY_VERIFIED' && (
              <p className="meta" style={{ marginTop: 8, marginBottom: 0 }}>
                Identity verification confirms who the seller is. It does not guarantee product
                quality.
              </p>
            )}
          </div>
          <section>
            <h2 style={{ fontSize: '1rem' }}>Delivery &amp; collection</h2>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {l.fulfilment.options.map((o, i) => (
                <li key={i}>
                  <strong>{FULFILMENT_LABEL[o.method]}</strong>
                  {o.collectionPoint && ` — ${o.collectionPoint.name}`}
                  {o.method === 'MERCHANT_DELIVERY'
                    ? l.fulfilment.deliveryAreas.length > 0 &&
                      ` — ${l.fulfilment.deliveryAreas.map((a) => `${a.name} ${naira(a.feeMinor)}`).join(', ')}`
                    : o.feeMinor > 0 && ` — ${naira(o.feeMinor)}`}
                </li>
              ))}
            </ul>
            {l.stockMode === 'MADE_TO_ORDER' && l.leadTimeDays > 0 && (
              <p className="small">
                Preparation time: about {l.leadTimeDays} day(s) after payment.
              </p>
            )}
            <p className="small muted">
              Delivery times are estimates. Live courier tracking is not available yet.
            </p>
          </section>
          <ShareButtons title={l.title} path={`/p/${l.slug}`} />
        </div>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Description</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{l.description || 'No description provided.'}</p>
          {Object.keys(l.attributes).length > 0 && (
            <dl className="kv">
              {Object.entries(l.attributes).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section className="card">
          <h2>Returns &amp; cancellations</h2>
          <p className="small" style={{ whiteSpace: 'pre-line' }}>
            <strong>Returns: </strong>
            {l.returnPolicy || 'See seller policy.'}
          </p>
          <p className="small" style={{ whiteSpace: 'pre-line' }}>
            <strong>Cancellations: </strong>
            {l.cancellationPolicy || 'Free cancellation before payment.'}
          </p>
          <EnquiryForm merchantSlug={m.slug} listingId={l.id} />
          <ReportLink targetType="LISTING" targetId={l.id} />
        </section>
      </div>
    </div>
  );
}
