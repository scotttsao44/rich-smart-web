'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Image as ImageIcon, QrCode } from 'lucide-react';

// 推广长图可勾选文字块（与 lib/cn-referral-poster.ts POSTER_BLOCKS 对应）
const POSTER_OPTIONS = [
  { key: 'a', label: '加企业微信说明' },
  { key: 'b', label: '7 项回复菜单' },
  { key: 'c', label: '店主／代理确认身份提示' },
  { key: 'd', label: '生成专属码提示' },
] as const;

type Status = { eligible: boolean; reason?: string; generated: boolean; referralCode?: string; createdAt?: string };

export default function FollowQrPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState(0);
  const [picked, setPicked] = useState<string[]>(POSTER_OPTIONS.map((o) => o.key));
  const [posterBusy, setPosterBusy] = useState(false);
  const [posterError, setPosterError] = useState('');
  const [posterSrc, setPosterSrc] = useState('');

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

  const generatePoster = async () => {
    setPosterBusy(true);
    setPosterError('');
    const blocks = POSTER_OPTIONS.map((o) => o.key).filter((k) => picked.includes(k)).join('');
    try {
      const res = await fetch('/api/cn/wechat/follow-qr/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) setPosterError(data.error || '生成失败，请稍后再试');
      else {
        setPosterSrc(`/api/cn/wechat/follow-qr/poster?blocks=${blocks}&t=${Date.now()}`);
        if (!status?.generated) await load();
      }
    } catch {
      setPosterError('生成失败，请稍后再试');
    } finally {
      setPosterBusy(false);
    }
  };

  // 同域 image/png（inline），勿用 <a download>：微信内会变成「接收文件」无法存相册
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
              <p className="mb-3 text-center text-base font-black leading-6 text-stone-900">长按图片保存到相册</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgSrc}
                alt="我的专属关注码"
                width={600}
                height={600}
                draggable={false}
                className="mx-auto block aspect-square w-full max-w-sm select-none rounded-xl border border-stone-100 bg-white object-contain p-2"
              />
              <p className="mt-3 text-center text-sm font-semibold leading-6 text-stone-600">
                微信内请<strong className="text-stone-900">长按上方二维码</strong>，选择「保存到相册」或转发给朋友。
              </p>
              <p className="mt-1 text-center text-xs text-stone-400">
                不要点页面外的「接收文件」；那是下载附件，无法存成图片。
              </p>
              {/* 非微信浏览器兜底：新窗口打开图片（无 download / attachment），不包在 img 外层 */}
              <a
                href={imgSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 block text-center text-xs font-bold text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline"
              >
                电脑端可点此在新窗口打开图片
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

      {status?.eligible && !needLogin ? (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-base font-black text-stone-900">我的推广长图</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">企业微信、服务号、商城三个二维码都带您的推荐信息，朋友扫哪个都记在您名下。勾选要放进图里的文字：</p>
          <div className="mt-3 space-y-2">
            {POSTER_OPTIONS.map((o) => (
              <label key={o.key} className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#1f7a4c]"
                  checked={picked.includes(o.key)}
                  onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, o.key] : prev.filter((k) => k !== o.key)))}
                />
                {o.label}
              </label>
            ))}
          </div>
          <button type="button" disabled={posterBusy} onClick={generatePoster} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1f7a4c] px-4 py-3.5 text-base font-bold text-white disabled:opacity-60">
            <ImageIcon className="h-4 w-4" /> {posterBusy ? '生成中…' : '生成我的推广长图'}
          </button>
          {posterError ? <p className="mt-3 text-center text-sm font-semibold text-red-600">{posterError}</p> : null}
          {posterSrc ? (
            <>
              <p className="mb-3 mt-5 text-center text-base font-black leading-6 text-stone-900">长按图片保存到相册</p>
              {/* 同域 image/png inline，不包链接、无 download：微信内长按存图 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={posterSrc} alt="我的推广长图" width={1080} draggable={false} className="mx-auto block w-full select-none rounded-xl border border-stone-100 bg-white" />
              <p className="mt-3 text-center text-sm font-semibold leading-6 text-stone-600">
                微信内请<strong className="text-stone-900">长按上方长图</strong>，选择「保存到相册」或转发给朋友。
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
