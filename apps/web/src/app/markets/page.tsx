import Link from 'next/link';
import { serverGet } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Markets & malls' };

interface Market {
  id: string;
  slug: string;
  name: string;
  kind: string;
  tagline: string;
  city: string;
  area: string | null;
  branded: boolean;
  merchantCount: number;
}

export default async function MarketsPage() {
  const markets = (await serverGet<Market[]>('/markets')) ?? [];
  return (
    <div className="stack">
      <h1>Markets &amp; malls</h1>
      <p className="muted">
        Shop participating malls and markets. Every store also appears in KDCN-wide search, so you
        can compare across markets in one place.
      </p>
      <div
        className="grid-products"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      >
        {markets.map((m) => (
          <Link key={m.id} href={`/markets/${m.slug}`} className="market-card">
            <div className="cover" />
            <div className="body">
              <strong>{m.name}</strong>{' '}
              {m.branded && <span className="badge badge-amber">Featured</span>}
              <div className="meta">{m.tagline}</div>
              <div className="meta">
                {m.area ? `${m.area}, ` : ''}
                {m.city} · {m.merchantCount} store{m.merchantCount === 1 ? '' : 's'}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
