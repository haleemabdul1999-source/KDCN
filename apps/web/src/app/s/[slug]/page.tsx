import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReportLink, ShareButtons } from '@/components/AddToCart';
import { ProductGrid } from '@/components/cards';
import { Pagination, Stars, VerifiedBadge } from '@/components/ui';
import { ViewTracker } from '@/components/Trackers';
import { date, FULFILMENT_LABEL, initials, MERCHANT_TYPE_LABEL } from '@/lib/format';
import { serverGet } from '@/lib/server';
import type { ListingCard, Paged, PublicMerchant } from '@/lib/types';

export const revalidate = 15;

interface Storefront {
  merchant: PublicMerchant;
  fulfilment: {
    methods: string[];
    collectionPoints: { name: string; publicAddress: string }[];
    deliveryAreas: string[];
  };
  rating: { average: number | null; count: number };
  reviews: {
    id: string;
    rating: number;
    body: string;
    merchantResponse: string | null;
    createdAt: string;
    customer: { name: string };
  }[];
  listings: Paged<ListingCard>;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const s = await serverGet<Storefront>(`/storefronts/${(await params).slug}`);
  return s
    ? { title: s.merchant.displayName, description: s.merchant.description.slice(0, 160) }
    : {};
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page = '1' } = await searchParams;
  const s = await serverGet<Storefront>(`/storefronts/${slug}?page=${Number(page) || 1}`);
  if (!s) notFound();
  const m = s.merchant;
  return (
    <div className="stack">
      <ViewTracker type="STOREFRONT_VIEW" merchantSlug={m.slug} />
      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            height: 140,
            background: m.coverUrl
              ? `center/cover url(${m.coverUrl})`
              : 'linear-gradient(135deg, var(--green-700), var(--amber-500))',
          }}
        />
        <div style={{ padding: 20 }} className="stack">
          <div className="row" style={{ alignItems: 'flex-end', marginTop: -62 }}>
            <div className="avatar avatar-lg" style={{ border: '4px solid #fff' }}>
              {m.logoUrl ? <img src={m.logoUrl} alt="" /> : initials(m.displayName)}
            </div>
          </div>
          <div className="row-between">
            <div>
              <h1 style={{ marginBottom: 4 }}>{m.displayName}</h1>
              <div className="muted">
                {MERCHANT_TYPE_LABEL[m.type]}
                {m.publicAreaLabel && ` · ${m.publicAreaLabel}`}
              </div>
            </div>
            <ShareButtons title={m.displayName} path={`/s/${m.slug}`} />
          </div>
          <div className="row">
            <VerifiedBadge verified={m.verification.status === 'IDENTITY_VERIFIED'} withHint />
            {m.markets.map((mk) => (
              <Link key={mk.id} href={`/markets/${mk.slug}`} className="badge badge-amber">
                {mk.name}
                {mk.unitLabel ? ` · ${mk.unitLabel}` : ''}
              </Link>
            ))}
            <Stars value={s.rating.average} />
            {m.memberSince && <span className="meta">On KDCN since {date(m.memberSince)}</span>}
          </div>
          {m.description && (
            <p style={{ whiteSpace: 'pre-line', marginBottom: 0 }}>{m.description}</p>
          )}
        </div>
      </section>

      <div className="grid-main-side">
        <section>
          <h2>Products ({s.listings.total})</h2>
          <ProductGrid
            items={s.listings.items}
            empty="This seller has no products listed right now."
          />
          <Pagination
            page={s.listings.page}
            pageSize={s.listings.pageSize}
            total={s.listings.total}
            href={(p) => `/s/${m.slug}?page=${p}`}
          />
        </section>
        <aside className="stack">
          <section className="card stack-sm">
            <h2 style={{ fontSize: '1rem' }}>How to get your order</h2>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
              {s.fulfilment.methods.map((x) => (
                <li key={x}>{FULFILMENT_LABEL[x]}</li>
              ))}
            </ul>
            {s.fulfilment.deliveryAreas.length > 0 && (
              <p className="small mb-0">Delivers to: {s.fulfilment.deliveryAreas.join(', ')}</p>
            )}
            {m.publicLocations.map((loc) => (
              <p key={loc.id} className="small mb-0">
                <strong>{loc.label}:</strong> {loc.address}
              </p>
            ))}
            {s.fulfilment.collectionPoints.map((cp) => (
              <p key={cp.name} className="small mb-0">
                <strong>Pickup point:</strong> {cp.name}
              </p>
            ))}
            {m.type === 'HOME_VENDOR' && (
              <p className="meta mb-0">
                This is a home-based business. Its address is private; orders are delivered or
                collected from a pickup point.
              </p>
            )}
          </section>
          <section className="card stack-sm">
            <h2 style={{ fontSize: '1rem' }}>Seller policies</h2>
            <p className="small mb-0">
              <strong>Returns:</strong> {m.returnPolicy || 'Not specified'}
            </p>
            <p className="small mb-0">
              <strong>Cancellations:</strong> {m.cancellationPolicy || 'Not specified'}
            </p>
            {(m.whatsappNumber || m.instagramHandle) && (
              <p className="small mb-0">
                {m.instagramHandle && <>Instagram: {m.instagramHandle} </>}
                {m.whatsappNumber && <>· WhatsApp: {m.whatsappNumber}</>}
              </p>
            )}
            <ReportLink targetType="MERCHANT" targetId={m.id} />
          </section>
          <section className="card stack-sm">
            <h2 style={{ fontSize: '1rem' }}>Reviews from verified purchases</h2>
            {s.reviews.length === 0 && <p className="muted small">No reviews yet.</p>}
            {s.reviews.map((r) => (
              <div
                key={r.id}
                className="small"
                style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}
              >
                <Stars value={r.rating} />{' '}
                <span className="meta">
                  — {r.customer.name}, {date(r.createdAt)}
                </span>
                {r.body && <p className="mb-0">{r.body}</p>}
                {r.merchantResponse && <p className="meta mb-0">Seller: {r.merchantResponse}</p>}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
