'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Loading } from '@/components/ui';

export default function MerchantIndex() {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && me?.merchants.length === 1) router.replace(`/merchant/${me.merchants[0].id}`);
  }, [me, loading, router]);
  if (loading || me?.merchants.length === 1) return <Loading />;
  if (!me)
    return (
      <p>
        <Link href="/login?next=/merchant">Sign in</Link> to manage your store.
      </p>
    );
  return (
    <div className="stack">
      <h1>Your stores</h1>
      {me.merchants.map((m) => (
        <Link
          key={m.id}
          href={`/merchant/${m.id}`}
          className="card-flat"
          style={{ display: 'block' }}
        >
          <strong>{m.displayName}</strong> <span className="meta">({m.role.toLowerCase()})</span>
        </Link>
      ))}
      <Link href="/sell" className="btn btn-secondary">
        Register another store
      </Link>
    </div>
  );
}
