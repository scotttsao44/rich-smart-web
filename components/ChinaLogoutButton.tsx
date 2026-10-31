'use client';

import { LogOut, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/providers';

export default function ChinaLogoutButton() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push('/cn/login');
  };

  if (!user) {
    return (
      <Link
        href="/cn/login"
        className="inline-flex items-center gap-2 rounded-lg bg-[#07C160] px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-[#06ad56]"
      >
        微信 / 会员登录
      </Link>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Link
        href="/cn/login?switch=1"
        title={`当前账号：${user.name}（点击可直接切换其他账号，无需先退出）`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        <span>切换账号</span>
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-700 hover:border-stone-400 hover:bg-stone-50"
      >
        <LogOut className="h-3.5 w-3.5" />
        退出
      </button>
    </div>
  );
}
