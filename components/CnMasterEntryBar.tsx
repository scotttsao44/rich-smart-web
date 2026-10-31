'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, UserCheck, RefreshCw, CalendarClock, Store } from 'lucide-react';
import { useAuth } from '@/app/providers';

export default function CnMasterEntryBar() {
  const { user } = useAuth();
  const [refCode, setRefCode] = useState('RS-CN-SCOOT');
  const [referrerName, setReferrerName] = useState('Scoot');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRef = (
      params.get('ref') ||
      params.get('r') ||
      params.get('referrerCode') ||
      ''
    ).trim().toUpperCase();
    if (urlRef) {
      setRefCode(urlRef);
    }
    const query = urlRef ? `?ref=${encodeURIComponent(urlRef)}` : '';
    fetch(`/api/cn/referral-link/pending${query}`, { cache: 'no-store', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const code = data?.referrerCode || data?.referredByCode;
        if (code) {
          setRefCode(String(code).toUpperCase());
        }
        if (data?.referrerName) {
          setReferrerName(String(data.referrerName));
        }
      })
      .catch(() => undefined);
  }, []);

  const encodedRef = encodeURIComponent(refCode || 'RS-CN-SCOOT');

  return (
    <div className="border-b border-emerald-200/80 bg-gradient-to-r from-emerald-50/90 via-white to-amber-50/70">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#07C160]/15 px-3 py-1 font-black text-[#069448]">
            <UserCheck className="h-3.5 w-3.5" />
            推荐归属：{referrerName || 'Scoot'}（{refCode}）
          </span>
          {user ? (
            <span className="font-semibold text-stone-700">
              当前已登录：<strong className="text-stone-950">{user.name}</strong>（支持直接切换新账号，无需先退出）
            </span>
          ) : (
            <span className="font-semibold text-stone-700">
              糙米官方一站式主入口 · 微信/手机一键领会员、逛商城、预约门店、品牌入驻
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user ? (
            <>
              <Link
                href="/cn/member"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#07C160] px-3.5 py-2 text-xs font-black text-white shadow-xs hover:bg-[#06ad56]"
              >
                进入会员与分享中心
              </Link>
              <Link
                href={`/cn/login?ref=${encodedRef}&switch=1`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-black text-emerald-900 hover:bg-emerald-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                切换 / 注册新账号（免退出）
              </Link>
            </>
          ) : (
            <Link
              href={`/cn/login?ref=${encodedRef}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#07C160] px-4 py-2 text-xs sm:text-sm font-black text-white shadow-xs hover:bg-[#06ad56]"
            >
              微信 / 手机一键登录领会员
            </Link>
          )}

          <Link
            href={`/cn/experience?ref=${encodedRef}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-black text-stone-800 hover:border-[var(--caomi-leaf-700)] hover:bg-stone-50"
          >
            <CalendarClock className="h-3.5 w-3.5 text-[var(--caomi-forest-700)]" />
            预约门店体验
          </Link>

          <Link
            href="/cn/brand/apply"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50/80 px-3 py-2 text-xs font-black text-amber-950 hover:bg-amber-100"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-700" />
            阿富 AI 品牌一句话入驻
          </Link>
        </div>
      </div>
    </div>
  );
}
