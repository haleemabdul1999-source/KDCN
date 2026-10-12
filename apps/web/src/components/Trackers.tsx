'use client';

import { useEffect } from 'react';
import { track } from '@/lib/api';

export function SearchTracker({ query, count }: { query: string; count: number }) {
  useEffect(() => {
    track('SEARCH', { query, resultCount: count });
    try {
      sessionStorage.setItem('kdcn_last_search', query);
    } catch {
      /* ignore */
    }
  }, [query, count]);
  return null;
}

export function ViewTracker({ type, listingId, merchantSlug }: { type: 'PRODUCT_VIEW' | 'STOREFRONT_VIEW'; listingId?: string; merchantSlug?: string }) {
  useEffect(() => {
    track(type, { listingId, merchantSlug });
    if (listingId) {
      try {
        // Attribute a click from search results (search-to-product conversion).
        if (sessionStorage.getItem('kdcn_last_search') && document.referrer.includes('/search')) {
          track('SEARCH_RESULT_CLICK', { listingId });
        }
      } catch {
        /* ignore */
      }
    }
  }, [type, listingId, merchantSlug]);
  return null;
}
