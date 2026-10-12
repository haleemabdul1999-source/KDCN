import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MerchantCard, ProductGrid } from '@/components/cards';
import { date } from '@/lib/format';
import { serverGet } from '@/lib/server';
import type { ListingCard, PublicMerchant } from '@/lib/types';

export const revalidate = 30;

interface MarketPage {
  id: string;
  slug: string;
  name: string;
  kind: string;
  tagline: string;
  description: string;
  publicAddress: string;
  openingHours: string;
  city: string;
  coverUrl: string | null;
  branded: boolean;
  announcements: { id: string; title: string; body: string; startsAt: string }[];
  collectionPoints: { id: string; name: string; publicAddress: string; openingHours: string; instructions: string }[];
  categories: { slug: string; name: string }[];
  merchants: PublicMerchant[];
  collections: { slug: string; title: string; description: string; items: ListingCard[] }[];
  newArrivals: ListingCard[];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const m = await serverGet<MarketPage>(`/markets/${(await params).slug}`);
  return m ? { title: m.name, description: m.tagline || m.description.slice(0, 160) } : {};
}

export default async function MarketLanding({ params }: { params: Promise<{ slug: string }> }) {
  const m = await serverGet<MarketPage>(`/markets/${(await params).slug}`);
  if (!m) notFound();
  return (
    <div className="stack">
      <section className="hero" style={m.coverUrl ? { background: `linear-gradient(rgba(6,59,43,.75), rgba(6,59,43,.75)), center/cover url(${m.coverUrl})` } : undefined}>
        <span className="badge badge-amber">{m.kind === 'SHOPPING_MALL' ? 'Shopping mall' : m.kind === 'TRADITIONAL_MARKET' ? 'Market' : 'Commercial cluster'}</span>
        <h1 style={{ marginTop: 8 }}>{m.name}</h1>
        <p>{m.tagline || m.description}</p>
        <form action="/search" className="hero-search" role="search">
          <input type="hidden" name="market" value={m.slug} />
          <label htmlFor="mq" className="sr-only">
            Search {m.name}
          </label>
          <input id="mq" name="q" placeholder={`Search ${m.name}…`} />
          <button type="submit">Search</button>
        </form>
        <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
          {m.publicAddress}
          {m.openingHours && ` · ${m.openingHours}`}
        </p>
      </section>

      {m.announcements.length > 0 && (
        <section className="stack-sm" aria-label="Announcements">
          {m.announcements.map((a) => (
            <div key={a.id} className="alert alert-warn">
              <strong>{a.title}</strong> <span className="meta">{date(a.startsAt)}</span>
              <div>{a.body}</div>
            </div>
          ))}
        </section>
      )}

      {m.categories.length > 0 && (
        <div className="chip-row" aria-label="Categories in this market">
          {m.categories.map((c) => (
            <Link key={c.slug} className="chip" href={`/search?market=${m.slug}&category=${c.slug}`}>
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="section-title">
        <h2>Stores ({m.merchants.length})</h2>
      </div>
      {m.merchants.length === 0 ? (
        <p className="muted">No stores are live yet.</p>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {m.merchants.map((x) => (
            <MerchantCard key={x.id} m={x} />
          ))}
        </div>
      )}

      {m.collections.map((c) => (
        <section key={c.slug}>
          <div className="section-title">
            <h2>{c.title}</h2>
          </div>
          <ProductGrid items={c.items} />
        </section>
      ))}

      <div className="section-title">
        <h2>New in {m.name}</h2>
        <Link href={`/search?market=${m.slug}&sort=newest`}>See all</Link>
      </div>
      <ProductGrid items={m.newArrivals} empty="No products yet." />

      {m.collectionPoints.length > 0 && (
        <section className="card">
          <h2>Collection points</h2>
          {m.collectionPoints.map((cp) => (
            <div key={cp.id} className="small" style={{ marginBottom: 8 }}>
              <strong>{cp.name}</strong> — {cp.publicAddress}
              {cp.openingHours && <> · {cp.openingHours}</>}
              {cp.instructions && <div className="meta">{cp.instructions}</div>}
            </div>
          ))}
        </section>
      )}
      {m.description && m.tagline && (
        <section className="card">
          <h2>About {m.name}</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{m.description}</p>
        </section>
      )}
    </div>
  );
}
