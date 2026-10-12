import Link from 'next/link';
import { MerchantCard, ProductGrid } from '@/components/cards';
import { serverGet } from '@/lib/server';
import type { ListingCard, PublicMerchant } from '@/lib/types';

export const dynamic = 'force-dynamic'; // data is still cached per-fetch (serverGet revalidate)

interface Home {
  markets: { id: string; slug: string; name: string; kind: string; tagline: string; branded: boolean; merchantCount: number; area: { name: string } | null }[];
  featuredMerchants: PublicMerchant[];
  recentListings: ListingCard[];
  homeVendorListings: ListingCard[];
  independentListings: ListingCard[];
  collections: { slug: string; title: string; description: string; items: ListingCard[] }[];
}
interface City {
  id: string;
  name: string;
  areas: { id: string; name: string }[];
}

export default async function HomePage() {
  const [home, cities] = await Promise.all([serverGet<Home>('/home'), serverGet<City[]>('/geo/cities', 3600)]);
  if (!home) return null;
  const areas = cities?.flatMap((c) => c.areas.map((a) => ({ ...a, city: c.name }))) ?? [];
  return (
    <div>
      <section className="hero">
        <h1>Shop Kaduna&apos;s stores, markets and home businesses — in one place</h1>
        <p>Find products from Galaxy Mall shops, market traders, independent stores and verified home-based vendors. Collect in store, at a pickup point, or get it delivered.</p>
        <form action="/search" className="hero-search" role="search">
          <label htmlFor="hero-q" className="sr-only">
            What are you looking for?
          </label>
          <input id="hero-q" name="q" placeholder="Ankara, cakes, phone chargers…" />
          <label htmlFor="hero-area" className="sr-only">
            Your area
          </label>
          <select id="hero-area" name="area" defaultValue="">
            <option value="">Anywhere in Kaduna</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="submit">Search</button>
        </form>
      </section>

      <div className="section-title">
        <h2>Markets &amp; malls</h2>
        <Link href="/markets">All markets</Link>
      </div>
      <div className="scroll-x">
        {home.markets.map((m) => (
          <Link key={m.id} href={`/markets/${m.slug}`} className="market-card">
            <div className="cover" />
            <div className="body">
              <strong>{m.name}</strong> {m.branded && <span className="badge badge-amber">Featured</span>}
              <div className="meta">
                {m.tagline || m.kind.replace('_', ' ').toLowerCase()} · {m.merchantCount} store{m.merchantCount === 1 ? '' : 's'}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {home.featuredMerchants.length > 0 && (
        <>
          <div className="section-title">
            <h2>Identity-verified sellers</h2>
          </div>
          <div className="scroll-x">
            {home.featuredMerchants.map((m) => (
              <MerchantCard key={m.id} m={m} />
            ))}
          </div>
        </>
      )}

      {home.collections.map((c) => (
        <section key={c.slug}>
          <div className="section-title">
            <h2>{c.title}</h2>
            <Link href={`/c/${c.slug}`}>See all</Link>
          </div>
          <ProductGrid items={c.items.slice(0, 8)} />
        </section>
      ))}

      <div className="section-title">
        <h2>Recently listed</h2>
        <Link href="/search?sort=newest">See all</Link>
      </div>
      <ProductGrid items={home.recentListings} empty="No products listed yet." />

      <div className="section-title">
        <h2>From home-based vendors</h2>
        <Link href="/search?merchantType=HOME_VENDOR">See all</Link>
      </div>
      <p className="muted small">Made-to-order food, fashion and crafts from Kaduna homes. Home vendors&apos; addresses are never shown — orders are delivered or collected from neutral pickup points.</p>
      <ProductGrid items={home.homeVendorListings} empty="No home-vendor products yet." />

      <div className="section-title">
        <h2>Independent shops</h2>
        <Link href="/search?merchantType=INDEPENDENT_SHOP">See all</Link>
      </div>
      <ProductGrid items={home.independentListings} empty="No independent-shop products yet." />
    </div>
  );
}
