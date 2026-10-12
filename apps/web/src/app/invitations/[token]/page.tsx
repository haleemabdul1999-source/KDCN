'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const { me, loading, refresh } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (!me)
    return (
      <Alert tone="info">
        <Link href={`/login?next=/invitations/${token}`}>Sign in</Link> or{' '}
        <Link href={`/register?next=/invitations/${token}`}>create an account</Link> with the email
        address the invitation was sent to.
      </Alert>
    );
  return (
    <div className="card stack" style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1>Join a store team</h1>
      <p>You&apos;ve been invited to help manage a store on KDCN.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <button
        className="btn"
        onClick={async () => {
          try {
            const r = await api<{ merchantId: string }>('/invitations/accept', { body: { token } });
            await refresh();
            router.push(`/merchant/${r.merchantId}`);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not accept the invitation');
          }
        }}
      >
        Accept invitation
      </button>
    </div>
  );
}
