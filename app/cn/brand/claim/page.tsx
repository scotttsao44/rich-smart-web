'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldCheck, Store } from 'lucide-react';
import CnReferralCapture from '@/components/CnReferralCapture';

type ClaimInfo = { status: 'pending' | 'claimed' | 'revoked' | 'expired'; expiresAt: string; brandId: number; brandName: string; claimedBy: number | null };
type Viewer = { loggedIn: boolean; memberId?: number; name?: string; hasWechat?: boolean; isPilot?: boolean; isAdmin?: boolean; ownedBrandIds?: number[] };

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  } catch {
    return value;
  }
}

export default function BrandClaimPage() {
  const [token, setToken] = useState('');
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [viewer, setViewer] = useState<Viewer>({ loggedIn: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [inWechat, setInWechat] = useState(false);
  const [refCode, setRefCode] = useState('');

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cn/brand-claim?t=${encodeURIComponent(t)}`, { cache: 'no-store', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      setClaim(data.claim || null);
      setViewer(data.viewer || { loggedIn: false });
    } catch {
      setError('网络异常，请刷新页面重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const t = search.get('t') || '';
    setRefCode((search.get('ref') || search.get('r') || '').trim().toUpperCase());
    setToken(t);
    setInWechat(/micromessenger/i.test(navigator.userAgent || ''));
    if (t) void load(t);
    else setLoading(false);
  }, [load]);

  // 推荐码随认领流程一路带到登录（沿用现有 ref 参数），登录/注册时由现有归属逻辑绑定上线
  const refQuery = refCode ? `&ref=${encodeURIComponent(refCode)}` : '';
  const returnTo = `/cn/brand/claim?t=${encodeURIComponent(token)}${refQuery}`;
  const loginHref = inWechat
    ? `/api/auth/wechat/official/start?returnTo=${encodeURIComponent(returnTo)}${refQuery}`
    : `/cn/login?returnTo=${encodeURIComponent(returnTo)}${refQuery}`;

  const confirmClaim = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/cn/brand-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'claim', token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '认领失败，请稍后重试');
      setDone(true);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : '认领失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const viewerReady = viewer.loggedIn && viewer.hasWechat && !viewer.isPilot && !viewer.isAdmin;
  const viewerBlockReason = !viewer.loggedIn
    ? ''
    : viewer.isAdmin
      ? '当前登录的是平台管理员账号，不能用来认领品牌。'
      : viewer.isPilot
        ? '当前登录的是品牌测试账号，不能用来认领品牌。'
        : !viewer.hasWechat
          ? '当前账号不是用微信登录的，认领品牌需要用微信登录。'
          : '';
  const claimedByMe = claim?.status === 'claimed' && viewer.memberId && claim.claimedBy === viewer.memberId;

  return (
    <main className="min-h-screen bg-[#f5f2ea] px-4 py-8 text-stone-950">
      <CnReferralCapture />
      <div className="mx-auto max-w-lg">
        <div className="flex items-center gap-3">
          <Store className="h-8 w-8 text-teal-700" />
          <div>
            <h1 className="text-2xl font-black">品牌认领</h1>
            <p className="text-sm font-semibold text-stone-600">用品牌方本人的微信接管品牌工作台</p>
          </div>
        </div>

        {loading ? <div className="mt-6 rounded-xl bg-white p-6 text-sm font-bold">读取中...</div> : null}

        {!loading && !claim ? (
          <section className="mt-6 rounded-xl border border-red-200 bg-white p-6">
            <h2 className="text-lg font-black">认领链接无效</h2>
            <p className="mt-2 text-sm text-stone-600">链接不完整或已失效，请向平台客服索取新的认领链接，并完整复制打开。</p>
          </section>
        ) : null}

        {!loading && claim && (claim.status === 'expired' || claim.status === 'revoked') ? (
          <section className="mt-6 rounded-xl border border-amber-200 bg-white p-6">
            <h2 className="text-lg font-black">{claim.status === 'expired' ? '认领链接已过期' : '认领链接已被撤销'}</h2>
            <p className="mt-2 text-sm text-stone-600">请联系平台客服，为「{claim.brandName}」重新发送认领链接。</p>
          </section>
        ) : null}

        {!loading && claim && claim.status === 'claimed' ? (
          claimedByMe ? (
            <section className="mt-6 rounded-xl border border-emerald-300 bg-white p-6">
              <div className="flex items-center gap-2 text-emerald-800"><CheckCircle2 className="h-6 w-6" /><h2 className="text-lg font-black">{done ? '认领成功！' : '您已认领此品牌'}</h2></div>
              <p className="mt-2 text-sm text-stone-700">「{claim.brandName}」已绑定到您的微信账号，您可以管理品牌和商品。</p>
              <p className="mt-2 text-sm font-bold text-stone-700">下一步：请提交贵公司的营业执照，变更品牌的公司主体（平台审核通过后生效）。</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Link href="/cn/brand/entity" className="inline-flex justify-center rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-black text-white">去变更公司主体</Link>
                <Link href="/vendor" className="inline-flex justify-center rounded-lg border border-teal-700 px-4 py-2.5 text-sm font-black text-teal-800">进入品牌工作台</Link>
              </div>
            </section>
          ) : (
            <section className="mt-6 rounded-xl border border-amber-200 bg-white p-6">
              <h2 className="text-lg font-black">该认领链接已被使用</h2>
              <p className="mt-2 text-sm text-stone-600">认领链接只能使用一次。如果是您本人认领的，请用认领时的微信登录后进入品牌工作台；如有疑问请联系平台客服。</p>
              <a href={loginHref} className="mt-4 inline-flex rounded-lg border border-teal-700 px-4 py-2 text-sm font-black text-teal-800">用其他微信登录</a>
            </section>
          )
        ) : null}

        {!loading && claim && claim.status === 'pending' ? (
          <div className="mt-6 space-y-4">
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs font-bold text-stone-500">待认领品牌</div>
              <div className="mt-1 text-2xl font-black">{claim.brandName}</div>
              <p className="mt-1 text-xs font-semibold text-stone-500">链接有效期至 {formatTime(claim.expiresAt)}（北京时间），仅可使用一次</p>
            </section>

            <section className={`rounded-xl border bg-white p-5 ${viewerReady ? 'border-emerald-200' : 'border-teal-600'}`}>
              <h2 className="text-base font-black">第 1 步：用您本人的微信登录</h2>
              {viewerReady ? (
                <p className="mt-2 text-sm font-bold text-emerald-800">✓ 已用微信登录：{viewer.name || '微信会员'}（会员号 {viewer.memberId}）</p>
              ) : (
                <>
                  {viewerBlockReason ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">{viewerBlockReason}请点下方按钮，切换为品牌方本人的微信。</p> : null}
                  <p className="mt-2 text-sm text-stone-600">
                    {inWechat
                      ? '点击下方按钮，微信会请您授权登录；授权后会自动回到本页面。'
                      : '电脑上会显示登录二维码，请用手机微信扫码并确认登录；登录后会自动回到本页面。也可以把本链接发到微信里直接打开。'}
                  </p>
                  <a href={loginHref} className="mt-3 inline-flex w-full justify-center rounded-lg bg-[#07c160] px-4 py-2.5 text-sm font-black text-white">
                    {inWechat ? '微信授权登录' : '微信扫码登录'}
                  </a>
                </>
              )}
            </section>

            <section className={`rounded-xl border bg-white p-5 ${viewerReady ? 'border-teal-600' : 'border-stone-200 opacity-60'}`}>
              <h2 className="text-base font-black">第 2 步：确认认领</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
                <li>认领后，这个微信账号将成为「{claim.brandName}」的品牌负责人，可在品牌工作台管理商品。</li>
                <li>原来的品牌测试账号将不再能管理此品牌。</li>
                <li>现有商品和品牌资料保持不变；公司主体需在下一步提交营业执照，经平台审核后才会变更。</li>
              </ul>
              {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
              <button
                type="button"
                disabled={!viewerReady || busy}
                onClick={() => void confirmClaim()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />{busy ? '认领中...' : `确认认领「${claim.brandName}」`}
              </button>
            </section>

            <section className="rounded-xl border border-stone-200 bg-white p-5 opacity-60">
              <h2 className="text-base font-black">第 3 步：变更公司主体</h2>
              <p className="mt-2 text-sm text-stone-600">认领成功后，上传贵公司的营业执照，填写公司名称、统一社会信用代码和联系人，提交平台审核。</p>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
