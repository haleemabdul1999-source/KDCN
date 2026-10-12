'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const [pw, setPw] = useState('');
  const [state, setState] = useState<'idle' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (state === 'done')
    return (
      <div className="card" style={{ maxWidth: 440, margin: '0 auto' }}>
        <Alert tone="success">Password updated. You&apos;ve been signed out everywhere.</Alert>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    );
  return (
    <form
      className="card"
      style={{ maxWidth: 440, margin: '0 auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api('/auth/password-reset/confirm', { body: { token, newPassword: pw } });
          setState('done');
        } catch (err) {
          setError(
            err instanceof ApiError ? (err.fieldErrors().newPassword ?? err.message) : 'Failed',
          );
        }
      }}
    >
      <h1>Choose a new password</h1>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="field">
        <label htmlFor="pw">New password</label>
        <input
          id="pw"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <div className="hint">At least 10 characters, with letters and numbers.</div>
      </div>
      <button className="btn btn-block">Update password</button>
    </form>
  );
}
