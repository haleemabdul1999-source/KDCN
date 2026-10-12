'use client';

import { useEffect } from 'react';
import { track } from '@/lib/api';

export function SearchTracker({ query, count }: { query: string; count: number }) {
  useEffect(() => {
    track('SEARCH', { query, resultCount: count });
    try {
      // Flag consumed by the next product view (client-side navigation leaves document.referrer unchanged).
      sessionStorage.setItem('kdcn_from_search', String(Date.now()));
    } catch {
      /* ignore */
    }
  }, [query, count]);
  return null;
}

export function ViewTracker({
  type,
  listingId,
  merchantSlug,
}: {
  type: 'PRODUCT_VIEW' | 'STOREFRONT_VIEW';
  listingId?: string;
  merchantSlug?: string;
}) {
  useEffect(() => {
    track(type, { listingId, merchantSlug });
    if (listingId) {
      try {
        // Attribute a click from search results (search-to-product conversion): the first product
        // view within 30 minutes of a search counts once.
        const at = Number(sessionStorage.getItem('kdcn_from_search'));
        if (at && Date.now() - at < 30 * 60_000) track('SEARCH_RESULT_CLICK', { listingId });
        sessionStorage.removeItem('kdcn_from_search');
      } catch {
        /* ignore */
      }
    }
  }, [type, listingId, merchantSlug]);
  return null;
}
