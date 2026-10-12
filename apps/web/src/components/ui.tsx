import Link from 'next/link';
import type { ReactNode } from 'react';
import { humanize, naira, STATUS_TONE } from '@/lib/format';
import type { Availability } from '@/lib/types';

export function Money({ minor, className }: { minor: number | null | undefined; className?: string }) {
  return <span className={className}>{naira(minor)}</span>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? ''}`}>{label ?? humanize(status)}</span>;
}

export function AvailabilityBadge({ a }: { a: Availability }) {
  const tone = a.code === 'OUT_OF_STOCK' ? 'badge-red' : a.code === 'IN_STOCK' || a.code === 'LOW_STOCK' ? 'badge-green' : 'badge-amber';
  return <span className={`badge ${tone}`}>{a.label}</span>;
}

/** Identity verification only — never presented as a product quality guarantee. */
export function VerifiedBadge({ verified, withHint }: { verified: boolean; withHint?: boolean }) {
  if (!verified) return null;
  return (
    <span className="badge badge-green" title="KDCN has verified this seller's identity. This is not a guarantee of product quality.">
      ✓ Identity verified{withHint ? ' by KDCN' : ''}
    </span>
  );
}

export function Alert({ tone = 'info', children, title }: { tone?: 'info' | 'success' | 'warn' | 'error'; children: ReactNode; title?: string }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title && <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>}
      {children}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: 24, justifyContent: 'center' }} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}…</span>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="row" aria-label="Pagination" style={{ justifyContent: 'center', marginTop: 24 }}>
      {page > 1 && (
        <Link className="btn btn-secondary btn-sm" href={href(page - 1)} rel="prev">
          ← Previous
        </Link>
      )}
      <span className="muted small">
        Page {page} of {pages}
      </span>
      {page < pages && (
        <Link className="btn btn-secondary btn-sm" href={href(page + 1)} rel="next">
          Next →
        </Link>
      )}
    </nav>
  );
}

export function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="muted small">No reviews yet</span>;
  const full = Math.round(value);
  return (
    <span aria-label={`${value.toFixed(1)} out of 5`} style={{ color: '#c27a12' }}>
      {'★'.repeat(full)}
      {'☆'.repeat(5 - full)} <span className="muted small">{value.toFixed(1)}</span>
    </span>
  );
}
