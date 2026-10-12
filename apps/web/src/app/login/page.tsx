'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Alert } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const { refresh, refreshCart } = useAuth();
  const [step, setStep] = useState<'password' | 'mfa' | 'enrol'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = async (dest: string) => {
    await refresh();
    await refreshCart();
    router.push(dest);
  };

  return (
    <div className="card" style={{ maxWidth: 440, margin: '0 auto' }}>
      {step === 'password' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            try {
              const r = await api<{ mfaRequired: boolean; mfaEnrolmentRequired: boolean }>(
                '/auth/login',
                { body: { email, password } },
              );
              if (r.mfaRequired) setStep('mfa');
              else if (r.mfaEnrolmentRequired) {
                setSecret(await api('/auth/mfa/setup', { method: 'POST' }));
                setStep('enrol');
              } else await finish(next);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Sign-in failed');
            } finally {
              setPending(false);
            }
          }}
        >
          <h1>Sign in</h1>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-block" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="small" style={{ marginTop: 16 }}>
            <Link href="/forgot-password">Forgot your password?</Link>
          </p>
          <p className="small">
            New to KDCN?{' '}
            <Link href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link>
          </p>
        </form>
      )}
      {(step === 'mfa' || step === 'enrol') && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            try {
              await api('/auth/mfa/verify', { body: { code } });
              await finish(next === '/' ? '/admin' : next);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Verification failed');
            } finally {
              setPending(false);
            }
          }}
        >
          <h1>Two-step verification</h1>
          {step === 'enrol' && secret && (
            <Alert tone="info" title="Set up your authenticator">
              Staff accounts require an authenticator app. Add this key to Google Authenticator,
              Microsoft Authenticator or similar, then enter the 6-digit code.
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 8 }}>
                {secret.secret}
              </div>
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button className="btn btn-block" disabled={pending}>
            Verify
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
