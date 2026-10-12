'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MerchantCtx, type MerchantProfile } from '@/components/MerchantContext';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { MERCHANT_TYPE_LABEL } from '@/lib/format';

export default function MerchantLayout({ children }: { children: ReactNode }) {
  const { merchantId } = useParams<{ merchantId: string }>();
  const path = usePathname();
  const [m, setM] = useState<MerchantProfile | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    try {
      setM(await api<MerchantProfile>(`/merchant/${merchantId}`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [merchantId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (error)
    return (
      <Alert tone="error">
        {error.status === 401 ? (
          <>
            <Link href={`/login?next=/merchant/${merchantId}`}>Sign in</Link> to manage your store.
          </>
        ) : (
          'Store not found or you do not have access.'
        )}
      </Alert>
    );
  if (!m) return <Loading label="Loading your store" />;
  const base = `/merchant/${m.id}`;
  const tabs = [
    ['Overview', base],
    ['Orders', `${base}/orders`],
    ['Products', `${base}/products`],
    ['Payouts', `${base}/payouts`],
    ['Customers', `${base}/customers`],
    ['Settings', `${base}/settings`],
    ['Verification', `${base}/onboarding`],
  ];
  return (
    <MerchantCtx.Provider value={{ m, reload, setM }}>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{m.displayName}</h1>
          <div className="meta">
            {MERCHANT_TYPE_LABEL[m.type]} · <StatusBadge status={m.status} /> {m.status === 'APPROVED' && <Link href={`/s/${m.slug}`}>View storefront</Link>}
          </div>
        </div>
      </div>
      {m.status === 'DRAFT' && (
        <Alert tone="info" title="Finish setting up your store">
          Complete the verification checklist to submit your store for review. You can add products now — they go live once you&apos;re approved. <Link href={`${base}/onboarding`}>Continue setup →</Link>
        </Alert>
      )}
      {m.status === 'PENDING_REVIEW' && <Alert tone="info">Your application is being reviewed by KDCN. We&apos;ll notify you by email.</Alert>}
      {m.status === 'INFO_REQUESTED' && (
        <Alert tone="warn" title="KDCN needs more information">
          {m.verification?.requestNote} <Link href={`${base}/onboarding`}>Update your application →</Link>
        </Alert>
      )}
      {m.status === 'REJECTED' && <Alert tone="error">Your application was not approved: {m.verification?.decisionNotes}</Alert>}
      {m.status === 'SUSPENDED' && <Alert tone="error">Your store is suspended: {m.suspensionReason}. Contact KDCN support.</Alert>}
      <nav className="dash-nav" aria-label="Store management" style={{ marginTop: 12 }}>
        {tabs.map(([label, href]) => (
          <Link key={href} href={href} aria-current={(href === base ? path === base : path.startsWith(href)) ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </MerchantCtx.Provider>
  );
}
