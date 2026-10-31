'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth, useCart } from '@/app/providers';
import { HeartPulse, LogIn, Menu, ShoppingCart, Store, UserCircle, X } from 'lucide-react';
import { useState } from 'react';

export default function Header() {
  const { user, logout } = useAuth();
  const { totalCount } = useCart();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (pathname?.startsWith('/cn') || pathname?.startsWith('/vendor') || pathname?.startsWith('/mini-preview')) {
    return null;
  }

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + '/');
  const isLinkActive = (href: string) => {
    if (href.includes('#')) return false;
    return isActive(href);
  };
  const primaryLinks = user
    ? [
      { href: '/cn/member', label: '会员中心', Icon: UserCircle },
      { href: '/cn/shop', label: '商城', Icon: ShoppingCart },
    ]
    : [
      { href: '/cn', label: '首页', Icon: Store },
      { href: '/cn/login', label: '登录', Icon: LogIn },
      { href: '/cn/experience', label: '新建会员', Icon: HeartPulse },
    ];

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        {/* Logo */}
        <Link href="/cn" className="flex items-center gap-2 text-lg font-bold text-amber-600">
          <Image src="/images/caomi-logo.png" alt="糙米" width={136} height={122} className="h-9 w-9 rounded-lg object-contain" />
          糙米
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto md:flex">
          {primaryLinks.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold ${
                isLinkActive(href)
                  ? 'bg-amber-50 text-amber-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
          <Link href="/cn/cart" className={`relative inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold ${isActive('/cn/cart') ? 'bg-amber-50 text-amber-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
            <span className="flex items-center gap-1"><ShoppingCart size={16} /> 购物车</span>
            {totalCount > 0 && (
              <span className="absolute -top-2 -right-3 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {totalCount}
              </span>
            )}
          </Link>
          {user && <span className="text-sm font-bold text-gray-500">{user.name}</span>}
          {user && <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600">退出登录</button>}
        </nav>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3">
          {primaryLinks.map(({ href, label }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)} className="block text-sm font-medium text-gray-700">
              {label}
            </Link>
          ))}
          <Link href="/cn/cart" onClick={() => setMobileOpen(false)} className="block text-sm font-medium text-gray-700">
            购物车 {totalCount > 0 && `(${totalCount})`}
          </Link>
          {user && (
            <button onClick={() => { logout(); setMobileOpen(false); }} className="block text-sm text-gray-500">退出登录</button>
          )}
        </div>
      )}
    </header>
  );
}
