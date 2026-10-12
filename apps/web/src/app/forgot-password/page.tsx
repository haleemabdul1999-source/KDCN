'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <form
      className="card"
      style={{ maxWidth: 440, margin: '0 auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        await api('/auth/password-reset/request', { body: { email } }).catch(() => undefined);
        setSent(true);
      }}
    >
      <h1>Reset your password</h1>
      {sent ? (
        <Alert tone="success">
          If an account exists for {email}, we&apos;ve sent a reset link. It expires in 30 minutes.
        </Alert>
      ) : (
        <>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button className="btn btn-block">Send reset link</button>
        </>
      )}
      <p className="small" style={{ marginTop: 16 }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
