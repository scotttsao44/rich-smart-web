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

/** 用 fetch→blob→objectURL 塞进 <img>，避免微信把 API URL 当附件「接收文件」。 */
function useBlobObjectUrl(enabled: boolean, loader: () => Promise<Blob | null>, deps: unknown[]) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) { setSrc(''); setFailed(false); return; }
    let alive = true;
    let objectUrl = '';
    setFailed(false);
    (async () => {
      try {
        const blob = await loader();
        if (!alive || !blob) { if (alive && !blob) setFailed(true); return; }
        objectUrl = URL.createObjectURL(blob);
        if (!alive) { URL.revokeObjectURL(objectUrl); return; }
        setSrc(objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return { src, failed };
}

export default function FollowQrPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState(0);
  const [picked, setPicked] = useState<string[]>(POSTER_OPTIONS.map((o) => o.key));
  const [posterBusy, setPosterBusy] = useState(false);
  const [posterError, setPosterError] = useState('');
  const [posterBlocks, setPosterBlocks] = useState('');
  const [posterStamp, setPosterStamp] = useState(0);

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
        setPosterBlocks(blocks);
        setPosterStamp(Date.now());
        if (!status?.generated) await load();
      }
    } catch {
      setPosterError('生成失败，请稍后再试');
    } finally {
      setPosterBusy(false);
    }
  };

  const qrBlob = useBlobObjectUrl(
    Boolean(status?.generated),
    async () => {
      const res = await fetch(`/api/cn/wechat/follow-qr?format=png&t=${stamp || Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (!type.includes('image/')) return null;
      return res.blob();
    },
    [stamp, status?.generated],
  );

  const posterBlob = useBlobObjectUrl(
    Boolean(posterBlocks && posterStamp),
    async () => {
      const res = await fetch(`/api/cn/wechat/follow-qr/poster?blocks=${encodeURIComponent(posterBlocks)}&t=${posterStamp}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (!type.includes('image/')) return null;
      return res.blob();
    },
    [posterBlocks, posterStamp],
  );

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
              {qrBlob.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrBlob.src}
                  alt="我的专属关注码"
                  width={600}
                  height={600}
                  draggable={false}
                  className="mx-auto block aspect-square w-full max-w-sm select-none rounded-xl border border-stone-100 bg-white object-contain p-2"
                />
              ) : (
                <div className="mx-auto flex aspect-square w-full max-w-sm items-center justify-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-400">
                  {qrBlob.failed ? '图片加载失败，请刷新重试' : '图片加载中…'}
                </div>
              )}
              <p className="mt-3 text-center text-sm font-semibold leading-6 text-stone-600">
                微信内请<strong className="text-stone-900">长按上方二维码</strong>，选择「保存到相册」或转发给朋友。
              </p>
              <p className="mt-1 text-center text-xs text-stone-400">
                不要点「接收文件」；那是下载附件，无法存成图片。
              </p>
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
          {posterBlocks && posterStamp ? (
            <>
              <p className="mb-3 mt-5 text-center text-base font-black leading-6 text-stone-900">长按图片保存到相册</p>
              {posterBlob.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={posterBlob.src} alt="我的推广长图" width={1080} draggable={false} className="mx-auto block w-full select-none rounded-xl border border-stone-100 bg-white" />
              ) : (
                <div className="mx-auto flex min-h-[12rem] w-full items-center justify-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-400">
                  {posterBlob.failed ? '长图加载失败，请重新生成' : '长图加载中…'}
                </div>
              )}
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
