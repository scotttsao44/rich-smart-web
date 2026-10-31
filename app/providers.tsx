'use client';

import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react';

interface AuthUser {
  id: number;
  name: string;
  email: string;
  agentLevel: number;
  role?: string;
  region: string;
  referralCode?: string;
  platformAdmin?: boolean;
  referralSharingEnabled?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => Promise<boolean>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: async () => false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    async function restoreSession() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          writeClientValue('richsmart_user', JSON.stringify(data.user));
          return;
        }
        // Server explicitly rejected session (e.g. 401): clear any stale cached user immediately
        setUser(null);
        removeClientValue('richsmart_user');
        return;
      } catch {
        // Network offline fallback only.
      }

      const stored = readClientValue('richsmart_user');
      if (stored) {
        try {
          setUser(JSON.parse(stored));
        } catch {
          removeClientValue('richsmart_user');
        }
      }
    }

    restoreSession();
  }, []);

  const login = (u: AuthUser) => {
    setUser(u);
    writeClientValue('richsmart_user', JSON.stringify(u));
  };

  const logout = useCallback(async () => {
    setUser(null);
    removeClientValue('richsmart_user');
    removeClientValue('rs_wx_device_token');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
      setUser(null);
      removeClientValue('richsmart_user');
      removeClientValue('rs_wx_device_token');
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const isAdmin = user?.platformAdmin === true || ['admin', 'staff'].includes(String(user?.role || '').toLowerCase());

  return (
    <AuthContext.Provider value={{ user, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export interface CartItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  currency?: 'TWD' | 'CNY';
  marketRegion?: 'TW' | 'CN';
  referrerBrandId?: number;
  referrerBrandName?: string;
  partnershipId?: string;
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  clearCart: () => void;
  totalCount: number;
  totalAmount: number;
}

const CartContext = createContext<CartContextType>({
  items: [],
  addItem: () => {},
  removeItem: () => {},
  updateQuantity: () => {},
  clearCart: () => {},
  totalCount: 0,
  totalAmount: 0,
});

const CART_STORAGE_KEY = 'richsmart_cart';

function readClientValue(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    const localValue = window.localStorage?.getItem(key);
    if (localValue) return localValue;
  } catch {
    // Embedded browsers may disable localStorage.
  }

  try {
    const cookie = document.cookie
      .split('; ')
      .find((part) => part.startsWith(`${key}=`));
    return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
  } catch {
    return null;
  }
}

function writeClientValue(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Cookie fallback below keeps the cart working across page changes.
  }

  try {
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 14}; SameSite=Lax`;
  } catch {
    // Ignore storage failures; the in-memory cart still works on the current page.
  }
}

function removeClientValue(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Embedded browsers may disable localStorage.
  }
  try {
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Ignore.
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const stored = readClientValue(CART_STORAGE_KEY);
    if (stored) {
      try {
        setItems(JSON.parse(stored));
      } catch {
        removeClientValue(CART_STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    writeClientValue(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = (item: CartItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === item.productId);
      if (existing) {
        const nextItems = prev.map((i) =>
          i.productId === item.productId
            ? { ...i, quantity: i.quantity + item.quantity }
            : i
        );
        writeClientValue(CART_STORAGE_KEY, JSON.stringify(nextItems));
        return nextItems;
      }
      const nextItems = [...prev, item];
      writeClientValue(CART_STORAGE_KEY, JSON.stringify(nextItems));
      return nextItems;
    });
  };

  const removeItem = (productId: number) => {
    setItems((prev) => {
      const nextItems = prev.filter((i) => i.productId !== productId);
      writeClientValue(CART_STORAGE_KEY, JSON.stringify(nextItems));
      return nextItems;
    });
  };

  const updateQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setItems((prev) => {
      const nextItems = prev.map((i) => (i.productId === productId ? { ...i, quantity } : i));
      writeClientValue(CART_STORAGE_KEY, JSON.stringify(nextItems));
      return nextItems;
    });
  };

  const clearCart = () => {
    setItems([]);
    writeClientValue(CART_STORAGE_KEY, JSON.stringify([]));
  };

  const totalCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQuantity, clearCart, totalCount, totalAmount }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
