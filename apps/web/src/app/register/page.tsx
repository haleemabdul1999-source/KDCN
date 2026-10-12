'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Alert } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

function RegisterForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/';
  const { refresh, refreshCart } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className="card"
      style={{ maxWidth: 480, margin: '0 auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        setErrors({});
        try {
          await api('/auth/register', { body: { ...form, phone: form.phone || undefined } });
          await refresh();
          await refreshCart();
          router.push(next);
        } catch (err) {
          if (err instanceof ApiError) {
            setErrors(err.fieldErrors());
            setError(err.message);
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <h1>Create your account</h1>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="field">
        <label htmlFor="name">Full name</label>
        <input id="name" required autoComplete="name" value={form.name} onChange={set('name')} />
        {errors.name && <div className="error">{errors.name}</div>}
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        {errors.email && <div className="error">{errors.email}</div>}
      </div>
      <div className="field">
        <label htmlFor="phone">Phone (for delivery updates)</label>
        <input id="phone" type="tel" autoComplete="tel" placeholder="080..." value={form.phone} onChange={set('phone')} />
        {errors.phone && <div className="error">{errors.phone}</div>}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" required autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} />
        <div className="hint">At least 10 characters, with letters and numbers.</div>
        {errors.password && <div className="error">{errors.password}</div>}
      </div>
      <p className="small muted">We only collect what we need to process your orders. See our privacy notice for how your data is used.</p>
      <button className="btn btn-block" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>
      <p className="small" style={{ marginTop: 16 }}>
        Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
