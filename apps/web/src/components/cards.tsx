import Link from 'next/link';
import { initials, MERCHANT_TYPE_LABEL, naira } from '@/lib/format';
import type { ListingCard, PublicMerchant } from '@/lib/types';
import { AvailabilityBadge, VerifiedBadge } from './ui';

export function ProductCard({ item }: { item: ListingCard }) {
  return (
    <Link href={`/p/${item.slug}`} className="product-card" data-testid="product-card">
      <div className="thumb">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.imageAlt}
            loading="lazy"
            decoding="async"
            width={300}
            height={300}
          />
        ) : (
          <span className="thumb-placeholder" aria-hidden="true">
            {initials(item.title)}
          </span>
        )}
      </div>
      <div className="body">
        <span className="title">{item.title}</span>
        <span className="price">
          {item.hasMultiplePrices && <span className="meta">from </span>}
          {naira(item.priceFromMinor)}
          {item.compareAtMinor && <span className="price-was">{naira(item.compareAtMinor)}</span>}
        </span>
        <span className="meta">
          {item.merchant.displayName}
          {item.merchant.markets[0]
            ? ` · ${item.merchant.markets[0].name}`
            : item.merchant.areaLabel
              ? ` · ${item.merchant.areaLabel}`
              : ''}
        </span>
        <span className="row" style={{ gap: 4, marginTop: 'auto' }}>
          <AvailabilityBadge a={item.availability} />
          {item.merchant.identityVerified && (
            <span
              className="badge badge-green"
              title="Seller identity verified by KDCN (not a product quality guarantee)"
            >
              ✓ ID
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

export function MerchantCard({ m }: { m: PublicMerchant }) {
  return (
    <Link href={`/s/${m.slug}`} className="merchant-card">
      <div className="avatar">
        {m.logoUrl ? <img src={m.logoUrl} alt="" loading="lazy" /> : initials(m.displayName)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{m.displayName}</div>
        <div className="meta">
          {MERCHANT_TYPE_LABEL[m.type]}
          {m.markets[0]
            ? ` · ${m.markets[0].name}`
            : m.publicAreaLabel
              ? ` · ${m.publicAreaLabel}`
              : ''}
        </div>
        <VerifiedBadge verified={m.verification.status === 'IDENTITY_VERIFIED'} />
      </div>
    </Link>
  );
}

export function ProductGrid({ items, empty }: { items: ListingCard[]; empty?: string }) {
  if (!items.length) return <p className="muted">{empty ?? 'Nothing here yet.'}</p>;
  return (
    <div className="grid-products">
      {items.map((i) => (
        <ProductCard key={i.id} item={i} />
      ))}
    </div>
  );
}
