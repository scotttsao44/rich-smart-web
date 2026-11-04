'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, QrCode } from 'lucide-react';

type Status = { eligible: boolean; reason?: string; generated: boolean; referralCode?: string; createdAt?: string };

export default function FollowQrPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch('/api/cn/wechat/follow-qr', { cache: 'no-store' });
    if (res.status === 401) { setNeedLogin(true); return; }
    setStatus(await res.json());
  }, []);

  useEffect(() => { load().catch(() => setError('读取失败，请刷新重试')); }, [load]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/cn/wechat/follow-qr', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) setError(data.error || '生成失败，请稍后再试');
      else { setStamp(Date.now()); await load(); }
    } catch {
      setError('生成失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const imgSrc = `/api/cn/wechat/follow-qr?format=png${stamp ? `&t=${stamp}` : ''}`;

  return (
    <main className="mx-auto min-h-screen max-w-md bg-stone-50 px-4 py-6">
      <Link href="/cn/member" className="inline-flex items-center gap-1 text-sm font-bold text-stone-600">
        <ArrowLeft className="h-4 w-4" /> 返回会员中心
      </Link>
      <h1 className="mt-4 text-xl font-black text-stone-900">我的专属关注码</h1>
      <p className="mt-1 text-sm text-stone-500">朋友扫码关注「糙米量子」服务号后，会自动记录为您推荐的好友。</p>

      {needLogin ? (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
          请先登录会员账号。
          <Link href={`/cn/login?returnTo=${encodeURIComponent('/cn/member/follow-qr')}`} className="ml-2 font-bold text-teal-700">去登录</Link>
        </div>
      ) : !status ? (
        <div className="mt-6 text-sm text-stone-500">{error || '加载中…'}</div>
      ) : !status.eligible ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
          您暂时还不能生成专属关注码。归属推荐人确认后，并在门店体验或在商城购买一次，即可取得推荐资格。
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
          {status.generated ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc} alt="我的专属关注码" className="mx-auto aspect-square w-full max-w-xs rounded-lg border border-stone-100" />
              <p className="mt-3 text-center text-xs text-stone-500">微信内长按图片可保存或转发给朋友</p>
              <a href={imgSrc} download={`专属关注码-${status.referralCode || ''}.png`} className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#07C160] px-4 py-3 text-base font-bold text-white">
                <Download className="h-4 w-4" /> 下载二维码图片
              </a>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={generate} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#07C160] px-4 py-3.5 text-base font-bold text-white disabled:opacity-60">
              <QrCode className="h-4 w-4" /> {busy ? '生成中…' : '生成我的专属关注码'}
            </button>
          )}
          {error ? <p className="mt-3 text-center text-sm font-semibold text-red-600">{error}</p> : null}
        </div>
      )}
    </main>
  );
}
