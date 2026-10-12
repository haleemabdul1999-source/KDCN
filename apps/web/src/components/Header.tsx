'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';

function SearchBox() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const router = useRouter();
  return (
    <form
      className="header-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <label htmlFor="site-search" className="sr-only">
        Search products, stores and markets
      </label>
      <input
        id="site-search"
        type="search"
        placeholder="Search products, stores, markets…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button type="submit">Search</button>
    </form>
  );
}

export function Header() {
  const { me, cartCount, refresh } = useAuth();
  const router = useRouter();
  const isStaff = (me?.staffRoles.length ?? 0) > 0;
  return (
    <header className="site-header">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="KDCN home">
          <span className="brand-mark">KD</span>
          <span>KDCN</span>
        </Link>
        <Suspense fallback={<div className="header-search" />}>
          <SearchBox />
        </Suspense>
        <nav className="header-nav" aria-label="Account">
          <Link href="/track">Track order</Link>
          {me ? (
            <>
              {isStaff && <Link href="/admin">Admin</Link>}
              {me.markets.length > 0 && (
                <Link href={`/operator/${me.markets[0].id}`}>Market portal</Link>
              )}
              {me.merchants.length > 0 ? (
                <Link href={`/merchant/${me.merchants[0].id}`}>My store</Link>
              ) : (
                <Link href="/sell">Sell</Link>
              )}
              <Link href="/account">Account</Link>
              <button
                className="btn-link"
                style={{ color: '#fff' }}
                onClick={async () => {
                  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
                  await refresh();
                  router.push('/');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/sell">Sell on KDCN</Link>
              <Link href="/login">Sign in</Link>
            </>
          )}
          <Link href="/cart" className="pill" aria-label={`Cart, ${cartCount} items`}>
            🛒 {cartCount}
          </Link>
        </nav>
      </div>
      <nav className="cat-nav" aria-label="Categories">
        <div className="container">
          <Link href="/markets/galaxy-mall">Galaxy Mall</Link>
          <Link href="/markets">Markets</Link>
          <Link href="/search?merchantType=HOME_VENDOR">Home vendors</Link>
          <Link href="/search?category=fashion">Fashion</Link>
          <Link href="/search?category=fabrics">Fabrics</Link>
          <Link href="/search?category=food">Food & baking</Link>
          <Link href="/search?category=beauty">Beauty</Link>
          <Link href="/search?category=electronics">Phones & electronics</Link>
          <Link href="/search?category=home">Home & living</Link>
        </div>
      </nav>
    </header>
  );
}
