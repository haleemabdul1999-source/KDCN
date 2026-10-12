export function naira(minor: number | null | undefined): string {
  if (minor == null) return '—';
  const n = minor / 100;
  return (
    '₦' +
    n.toLocaleString('en-NG', {
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

export function date(d: string | Date | null | undefined, withTime = false): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString(
    'en-NG',
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  );
}

export function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export const MERCHANT_TYPE_LABEL: Record<string, string> = {
  HOME_VENDOR: 'Home-based vendor',
  MALL_RETAILER: 'Shopping mall store',
  MARKET_TRADER: 'Market trader',
  INDEPENDENT_SHOP: 'Independent shop',
};

export const FULFILMENT_LABEL: Record<string, string> = {
  IN_STORE_COLLECTION: 'Collect in store',
  COLLECTION_POINT: 'Collect at a pickup point',
  MERCHANT_DELIVERY: 'Delivery by seller',
  THIRD_PARTY_DELIVERY: 'Delivery (KDCN-arranged courier)',
};

export const STATUS_TONE: Record<string, string> = {
  PENDING_MERCHANT_CONFIRMATION: 'badge-amber',
  AWAITING_PAYMENT: 'badge-amber',
  PAYMENT_PENDING_VERIFICATION: 'badge-amber',
  PAID: 'badge-blue',
  ACCEPTED_FOR_FULFILMENT: 'badge-blue',
  PREPARING: 'badge-blue',
  READY_FOR_COLLECTION: 'badge-green',
  DISPATCHED: 'badge-green',
  DELIVERED: 'badge-green',
  COMPLETED: 'badge-green',
  CANCELLED: '',
  REFUND_PENDING: 'badge-red',
  REFUNDED: '',
  DISPUTED: 'badge-red',
  APPROVED: 'badge-green',
  PENDING_REVIEW: 'badge-amber',
  INFO_REQUESTED: 'badge-amber',
  REJECTED: 'badge-red',
  SUSPENDED: 'badge-red',
  DRAFT: '',
  ACTIVE: 'badge-green',
  PAUSED: 'badge-amber',
  BLOCKED: 'badge-red',
  SUCCEEDED: 'badge-green',
  FAILED: 'badge-red',
  PENDING: 'badge-amber',
  REQUESTED: 'badge-amber',
  PROCESSING: 'badge-blue',
  ELIGIBLE: 'badge-blue',
  SETTLED: 'badge-green',
  ON_HOLD: 'badge-red',
  REVERSED: '',
  PENDING_FULFILMENT: 'badge-amber',
};

export function humanize(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}
