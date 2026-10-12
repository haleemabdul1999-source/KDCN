import Link from 'next/link';
import { ProductGrid } from '@/components/cards';
import { Pagination } from '@/components/ui';
import { SearchTracker } from '@/components/Trackers';
import { serverGet } from '@/lib/server';
import type { ListingCard, Paged } from '@/lib/types';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;
interface Category {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
}
interface Market {
  slug: string;
  name: string;
}
interface City {
  slug: string;
  name: string;
  areas: { id: string; name: string }[];
}

const KEYS = ['q', 'category', 'market', 'merchant', 'city', 'area', 'minPrice', 'maxPrice', 'availability', 'fulfilment', 'verified', 'merchantType', 'sort'] as const;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return { title: sp.q ? `“${sp.q}” — search` : 'Search' };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of KEYS) if (sp[k]) qs.set(k, k === 'minPrice' || k === 'maxPrice' ? String(Math.round(Number(sp[k]) * 100)) : sp[k]!);
  qs.set('page', sp.page ?? '1');
  const [results, categories, markets, cities] = await Promise.all([
    serverGet<Paged<ListingCard>>(`/search?${qs.toString()}`, 0).catch(() => null),
    serverGet<Category[]>('/categories', 3600),
    serverGet<Market[]>('/markets', 300),
    serverGet<City[]>('/geo/cities', 3600),
  ]);
  const href = (page: number) => {
    const p = new URLSearchParams();
    for (const k of KEYS) if (sp[k]) p.set(k, sp[k]!);
    p.set('page', String(page));
    return `/search?${p.toString()}`;
  };
  const marketName = markets?.find((m) => m.slug === sp.market)?.name;

  return (
    <div className="grid-side-main">
      <aside>
        <form action="/search" className="card" aria-label="Filters">
          <h2 className="small" style={{ fontSize: '1rem' }}>
            Filter
          </h2>
          <div className="field">
            <label htmlFor="f-q">Keywords</label>
            <input id="f-q" name="q" defaultValue={sp.q ?? ''} type="search" />
          </div>
          <div className="field">
            <label htmlFor="f-cat">Category</label>
            <select id="f-cat" name="category" defaultValue={sp.category ?? ''}>
              <option value="">All categories</option>
              {categories?.map((c) => (
                <optgroup key={c.slug} label={c.name}>
                  <option value={c.slug}>All {c.name}</option>
                  {c.children.map((ch) => (
                    <option key={ch.slug} value={ch.slug}>
                      {ch.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-market">Market or mall</label>
            <select id="f-market" name="market" defaultValue={sp.market ?? ''}>
              <option value="">Any (incl. independent &amp; home)</option>
              {markets?.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-type">Seller type</label>
            <select id="f-type" name="merchantType" defaultValue={sp.merchantType ?? ''}>
              <option value="">All sellers</option>
              <option value="MALL_RETAILER">Shopping mall stores</option>
              <option value="MARKET_TRADER">Market traders</option>
              <option value="INDEPENDENT_SHOP">Independent shops</option>
              <option value="HOME_VENDOR">Home-based vendors</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-area">Neighbourhood</label>
            <select id="f-area" name="area" defaultValue={sp.area ?? ''}>
              <option value="">Anywhere</option>
              {cities?.map((c) => (
                <optgroup key={c.slug} label={c.name}>
                  {c.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="hint">Sellers located in or delivering to this area.</div>
          </div>
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="f-min">Min ₦</label>
              <input id="f-min" name="minPrice" type="number" min={0} defaultValue={sp.minPrice ?? ''} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="f-max">Max ₦</label>
              <input id="f-max" name="maxPrice" type="number" min={0} defaultValue={sp.maxPrice ?? ''} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="f-av">Availability</label>
            <select id="f-av" name="availability" defaultValue={sp.availability ?? 'any'}>
              <option value="any">Any</option>
              <option value="in_stock">In stock now</option>
              <option value="made_to_order">Made to order</option>
              <option value="confirm_on_order">Seller confirms availability</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-ful">Delivery / collection</label>
            <select id="f-ful" name="fulfilment" defaultValue={sp.fulfilment ?? 'any'}>
              <option value="any">Any</option>
              <option value="delivery">Delivery available</option>
              <option value="collection">Collection available</option>
            </select>
          </div>
          <label className="checkbox field">
            <input type="checkbox" name="verified" value="true" defaultChecked={sp.verified === 'true'} /> Identity-verified sellers only
          </label>
          <div className="field">
            <label htmlFor="f-sort">Sort by</label>
            <select id="f-sort" name="sort" defaultValue={sp.sort ?? 'relevance'}>
              <option value="relevance">Best match</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </div>
          <button className="btn btn-block" type="submit">
            Apply filters
          </button>
          <Link href="/search" className="btn btn-link btn-block" style={{ marginTop: 8 }}>
            Clear all
          </Link>
        </form>
      </aside>
      <section aria-live="polite">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem' }}>
            {sp.q ? `Results for “${sp.q}”` : 'Browse products'}
            {marketName ? ` in ${marketName}` : ''}
          </h1>
          {results && <span className="muted small">{results.total} result{results.total === 1 ? '' : 's'}</span>}
        </div>
        {!results ? (
          <div className="alert alert-error">Search is temporarily unavailable. Please try again.</div>
        ) : results.items.length === 0 ? (
          <div className="empty">
            <h3>No products found</h3>
            <p>Try a different word, fewer filters, or browse a market.</p>
            <Link className="btn btn-secondary" href="/markets">
              Browse markets
            </Link>
          </div>
        ) : (
          <>
            <ProductGrid items={results.items} />
            <Pagination page={results.page} pageSize={results.pageSize} total={results.total} href={href} />
          </>
        )}
        {sp.q && results && <SearchTracker query={sp.q} count={results.total} />}
        <p className="muted small" style={{ marginTop: 16 }}>
          Results are ranked by relevance and availability. KDCN does not currently sell placement in search results.
        </p>
      </section>
    </div>
  );
}
