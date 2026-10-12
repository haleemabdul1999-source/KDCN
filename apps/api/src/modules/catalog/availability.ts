import { StockMode } from '@prisma/client';

export interface Availability {
  code: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'CONFIRM_ON_ORDER' | 'MADE_TO_ORDER';
  label: string;
  purchasable: boolean;
  /** Only disclosed when low, to avoid implying precise real-time stock otherwise. */
  quantityHint?: number;
}

/**
 * Honest availability messaging. We never show a stock guarantee for listings whose merchant
 * does not maintain a stock count; those orders require merchant confirmation before payment.
 */
export function availabilityFor(
  stockMode: StockMode,
  leadTimeDays: number,
  inventory: { quantity: number; reserved: number } | null | undefined,
): Availability {
  if (stockMode === StockMode.MADE_TO_ORDER) {
    return {
      code: 'MADE_TO_ORDER',
      label:
        leadTimeDays > 0
          ? `Made to order · ready in about ${leadTimeDays} day${leadTimeDays === 1 ? '' : 's'}`
          : 'Made to order',
      purchasable: true,
    };
  }
  if (stockMode === StockMode.CONFIRM_ON_ORDER) {
    return {
      code: 'CONFIRM_ON_ORDER',
      label: 'Seller confirms availability before you pay',
      purchasable: true,
    };
  }
  const available = Math.max(0, (inventory?.quantity ?? 0) - (inventory?.reserved ?? 0));
  if (available <= 0) return { code: 'OUT_OF_STOCK', label: 'Out of stock', purchasable: false };
  if (available <= 5)
    return {
      code: 'LOW_STOCK',
      label: `Only ${available} left`,
      purchasable: true,
      quantityHint: available,
    };
  return { code: 'IN_STOCK', label: 'In stock', purchasable: true };
}
