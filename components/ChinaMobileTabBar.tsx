'use client';

import Link from 'next/link';
import { Home, ShoppingBag, ShoppingCart, UserCircle } from 'lucide-react';
import { useCart } from '@/app/providers';

const tabs = [
  { key: 'home', label: '首页', href: '/cn/home', icon: Home },
  { key: 'shop', label: '商城', href: '/cn/shop', icon: ShoppingBag },
  { key: 'cart', label: '购物车', href: '/cn/cart', icon: ShoppingCart },
  { key: 'member', label: '我的', href: '/cn/member', icon: UserCircle },
] as const;

export default function ChinaMobileTabBar({ active }: { active: 'home' | 'shop' | 'cart' | 'member' }) {
  const { items } = useCart();

  return (
    <nav
      aria-label="会员主导航"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[#dce3d8] bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={selected ? 'page' : undefined}
            className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-black ${selected ? 'text-[var(--caomi-forest-700)]' : 'text-stone-500'}`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" />
              {tab.key === 'cart' && items.length ? (
                <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white">
                  {items.length}
                </span>
              ) : null}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
