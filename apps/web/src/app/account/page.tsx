'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { date } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Notifications {
  items: { id: string; subject: string; body: string; readAt: string | null; createdAt: string; data: { orderId?: string } }[];
  unread: number;
}
interface Enquiry {
  id: string;
  message: string;
  reply: string | null;
  createdAt: string;
  merchant: { slug: string; displayName: string };
}

export default function AccountPage() {
  const { me, loading } = useAuth();
  const notes = useApi<Notifications>(me ? '/notifications' : null);
  const enquiries = useApi<Enquiry[]>(me ? '/enquiries' : null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwMsg, setPwMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (loading) return <Loading />;
  if (!me)
    return (
      <Alert tone="info">
        <Link href="/login?next=/account">Sign in</Link> to view your account.
      </Alert>
    );
  return (
    <div className="stack">
      <h1>Hello, {me.name.split(' ')[0]}</h1>
      <div className="row">
        <Link className="btn btn-secondary" href="/orders">
          My orders
        </Link>
        {me.merchants.length === 0 && (
          <Link className="btn btn-secondary" href="/sell">
            Start selling
          </Link>
        )}
      </div>
      <div className="grid-2">
        <section className="card stack-sm">
          <div className="row-between">
            <h2 className="mb-0">Notifications</h2>
            {notes.data && notes.data.unread > 0 && (
              <button className="btn btn-link small" onClick={async () => (await api('/notifications/read-all', { method: 'POST' }), notes.reload())}>
                Mark all read
              </button>
            )}
          </div>
          {notes.loading && <Loading />}
          {notes.data?.items.length === 0 && <p className="muted small">No notifications yet.</p>}
          {notes.data?.items.map((n) => (
            <div key={n.id} className="card-flat small" style={{ borderLeft: n.readAt ? undefined : '4px solid var(--amber-500)' }}>
              <strong>{n.subject}</strong> <span className="meta">{date(n.createdAt, true)}</span>
              <div>{n.body}</div>
              {n.data.orderId && <Link href={`/orders/${n.data.orderId}`}>View order</Link>}
            </div>
          ))}
        </section>
        <div className="stack">
          <section className="card stack-sm">
            <h2>Questions to sellers</h2>
            {enquiries.data?.length === 0 && <p className="muted small">You haven&apos;t asked any questions.</p>}
            {enquiries.data?.map((e) => (
              <div key={e.id} className="card-flat small">
                <strong>{e.merchant.displayName}</strong> <span className="meta">{date(e.createdAt)}</span>
                <div>{e.message}</div>
                <div className={e.reply ? '' : 'muted'}>{e.reply ? `Reply: ${e.reply}` : 'Awaiting reply'}</div>
              </div>
            ))}
          </section>
          <form
            className="card"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/auth/password', { body: pw });
                setPwMsg({ tone: 'success', text: 'Password changed. Other devices have been signed out.' });
                setPw({ currentPassword: '', newPassword: '' });
              } catch (err) {
                setPwMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Failed' });
              }
            }}
          >
            <h2>Change password</h2>
            {pwMsg && <Alert tone={pwMsg.tone}>{pwMsg.text}</Alert>}
            <div className="field">
              <label htmlFor="cp">Current password</label>
              <input id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="np">New password</label>
              <input id="np" type="password" autoComplete="new-password" minLength={10} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
            </div>
            <button className="btn btn-secondary">Update password</button>
          </form>
        </div>
      </div>
    </div>
  );
}
