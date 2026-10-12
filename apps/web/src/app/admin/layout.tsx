'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Loading } from '@/components/ui';

const TABS: [string, string][] = [
  ['Overview', '/admin'],
  ['Merchants', '/admin/merchants'],
  ['Moderation', '/admin/moderation'],
  ['Orders', '/admin/orders'],
  ['Disputes', '/admin/disputes'],
  ['Fulfilment', '/admin/fulfilment'],
  ['Finance', '/admin/finance'],
  ['Platform', '/admin/platform'],
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const path = usePathname();
  if (loading) return <Loading />;
  if (!me || me.staffRoles.length === 0)
    return (
      <Alert tone="error">
        KDCN staff only. <Link href="/login?next=/admin">Sign in</Link>
      </Alert>
    );
  if (!me.mfaVerified)
    return (
      <Alert tone="warn">
        Two-step verification is required for staff.{' '}
        <Link href="/login?next=/admin">Sign in again</Link> to verify.
      </Alert>
    );
  return (
    <div>
      <div className="row-between">
        <h1 className="mb-0">KDCN Admin</h1>
        <span className="meta">Roles: {me.staffRoles.join(', ').toLowerCase()}</span>
      </div>
      <nav className="dash-nav" aria-label="Admin" style={{ marginTop: 12 }}>
        {TABS.map(([l, h]) => (
          <Link
            key={h}
            href={h}
            aria-current={(h === '/admin' ? path === h : path.startsWith(h)) ? 'page' : undefined}
          >
            {l}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
