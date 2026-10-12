'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  cartCount: number;
  refreshCart: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  me: null,
  loading: true,
  refresh: async () => undefined,
  cartCount: 0,
  refreshCart: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [cartCount, setCartCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me | null }>('/auth/me');
      setMe(r.user);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCart = useCallback(async () => {
    try {
      const c = await api<{ itemCount: number }>('/cart');
      setCartCount(c.itemCount);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshCart();
  }, [refresh, refreshCart]);

  return (
    <Ctx.Provider value={{ me, loading, refresh, cartCount, refreshCart }}>{children}</Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
