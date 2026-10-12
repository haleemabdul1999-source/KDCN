/** Money helpers. All authoritative amounts are integer minor units (kobo). */

export const MAX_AMOUNT_MINOR = 2_000_000_000; // ₦20,000,000 — stays well inside Postgres int4.

export function assertMinor(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT_MINOR) {
    throw new Error(`${label} must be a non-negative integer number of minor units`);
  }
  return value;
}

/** Commission in basis points, rounded half-up to the nearest kobo using integer arithmetic. */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error('bps out of range');
  return Math.floor((amountMinor * bps + 5_000) / 10_000);
}

export function formatNaira(minor: number): string {
  const naira = Math.trunc(minor / 100);
  const kobo = Math.abs(minor % 100);
  return `₦${naira.toLocaleString('en-NG')}${kobo ? '.' + kobo.toString().padStart(2, '0') : ''}`;
}
