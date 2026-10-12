import { ConflictException, Injectable } from '@nestjs/common';
import { StockMode } from '@prisma/client';
import { Tx } from '../../common/prisma.service';

export interface StockLine {
  listingVariantId: string;
  quantity: number;
  stockMode: StockMode;
  title?: string;
}

/**
 * Inventory reservation for TRACKED listings. All operations are single conditional UPDATEs,
 * which are atomic under concurrency: two customers racing for the last unit cannot both
 * reserve it, and the CHECK constraints in migration 0002 are a final backstop.
 */
@Injectable()
export class InventoryService {
  async reserve(tx: Tx, lines: StockLine[]): Promise<boolean> {
    const tracked = lines.filter((l) => l.stockMode === StockMode.TRACKED);
    for (const l of tracked) {
      const n = await tx.$executeRaw`
        UPDATE inventory SET reserved = reserved + ${l.quantity}, "updatedAt" = now()
        WHERE "listingVariantId" = ${l.listingVariantId} AND quantity - reserved >= ${l.quantity}`;
      if (n !== 1) {
        throw new ConflictException({ message: `${l.title ?? 'An item'} is no longer available in the requested quantity`, code: 'OUT_OF_STOCK', listingVariantId: l.listingVariantId });
      }
    }
    return tracked.length > 0;
  }

  async release(tx: Tx, lines: StockLine[]): Promise<void> {
    for (const l of lines.filter((x) => x.stockMode === StockMode.TRACKED)) {
      await tx.$executeRaw`
        UPDATE inventory SET reserved = GREATEST(reserved - ${l.quantity}, 0), "updatedAt" = now()
        WHERE "listingVariantId" = ${l.listingVariantId}`;
    }
  }

  /** Convert a reservation into a sale (on payment). */
  async commit(tx: Tx, lines: StockLine[]): Promise<void> {
    for (const l of lines.filter((x) => x.stockMode === StockMode.TRACKED)) {
      await tx.$executeRaw`
        UPDATE inventory SET quantity = quantity - ${l.quantity}, reserved = GREATEST(reserved - ${l.quantity}, 0), "updatedAt" = now()
        WHERE "listingVariantId" = ${l.listingVariantId} AND quantity >= ${l.quantity}`;
    }
  }
}
