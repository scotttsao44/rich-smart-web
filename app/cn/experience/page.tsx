'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/providers';
import ReferralQrCode from '@/components/ReferralQrCode';
import WechatShareButton from '@/components/WechatShareButton';

interface ExperienceMemberInfo {
  id: number;
  name: string;
  phone: string;
  email: string;
  referralCode: string;
  referrerCode: string;
  referrerName: string;
  profileAuthorized: boolean;
  onboardingCompleted: boolean;
}

function CnExperienceContent() {
  const { user, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const refFromUrl = (
    searchParams.get('ref') ||
    searchParams.get('r') ||
    searchParams.get('referrerCode') ||
    searchParams.get('referrer') ||
    ''
  ).trim().toUpperCase();
  const returnTo = searchParams.get('returnTo') || searchParams.get('next') || '/cn/member';

  const [member, setMember] = useState<ExperienceMemberInfo | null>(null);
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [referrerCode, setReferrerCode] = useState(refFromUrl || 'RS-CN-SCOOT');
  const [referrerName, setReferrerName] = useState('Scoot（平台主管）');

  const [bootstrapping, setBootstrapping] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQrPreview, setShowQrPreview] = useState(false);

  const shareOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://caomi.47-116-127-122.sslip.io';
  const myShareLink = member?.referralCode
    ? `${shareOrigin}/cn?ref=${encodeURIComponent(member.referralCode)}`
    : '';

  const initExperience = useCallback(async () => {
    setBootstrapping(true);
    setError('');
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('rs_wx_device_token');
      } catch {
        // ignore
      }
    }
    try {
      // Clear any residual rs_wx_identity cookie
      await fetch('/api/auth/wechat/quick-login', { cache: 'no-store' }).catch(() => null);

      // Sync referral attribution cookie and resolve referrer name
      let resolvedRefCode = refFromUrl || 'RS-CN-SCOOT';
      let resolvedRefName = 'Scoot（平台主管）';
      const pendingUrl = `/api/cn/referral-link/pending${refFromUrl ? `?ref=${encodeURIComponent(refFromUrl)}` : ''}`;
      const pendingRes = await fetch(pendingUrl, { cache: 'no-store', credentials: 'include' }).catch(() => null);
      if (pendingRes && pendingRes.ok) {
        const pendingData = await pendingRes.json().catch(() => null);
        const code = pendingData?.referrerCode || pendingData?.referredByCode;
        if (code) resolvedRefCode = String(code).toUpperCase();
        if (pendingData?.referrerName) resolvedRefName = String(pendingData.referrerName);
      }
      setReferrerCode(resolvedRefCode);
      setReferrerName(resolvedRefName);

      // If URL explicitly has ?ref=... for inviting a new downline member, only restore session if it's not a new referral registration
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      const meData = meRes.ok ? await meRes.json().catch(() => null) : null;
      const inWechat = typeof navigator !== 'undefined' && /micromessenger/i.test(navigator.userAgent || '');
      // 微信内打开推荐链接且未登录：直接走公众号授权登录，带上链接推荐码，回来即为已登录会员
      if (inWechat && !meData?.user) {
        const qs = new URLSearchParams();
        if (refFromUrl) qs.set('ref', refFromUrl);
        qs.set('returnTo', `/cn/experience${refFromUrl ? `?ref=${encodeURIComponent(refFromUrl)}` : ''}`);
        window.location.replace(`/api/auth/wechat/official/start?${qs.toString()}`);
        return;
      }
      if (meData) {
        if (meData?.user) {
          const u = meData.user;
          const uOwnCode = String(u.referralCode || '').trim().toUpperCase();
          // If the visitor clicked a referral link (?ref=...), start fresh registration if the logged-in user is the referrer themselves or another account
          // 已登录会员打开自己的推荐链接：视为更新本人资料（不清空、不自我推荐）
          if (!refFromUrl || inWechat || uOwnCode === refFromUrl) {
            const ownRefCode = String(u.referrerCode || resolvedRefCode || '').trim().toUpperCase() || resolvedRefCode;
            const ownRefName = String(u.referrerName || resolvedRefName || '').trim() || resolvedRefName;
            setMember({
              id: u.id,
              name: u.name,
              phone: u.phone || '',
              email: u.email && !String(u.email).endsWith('@local.invalid') ? u.email : '',
              referralCode: u.referralCode || '',
              referrerCode: ownRefCode,
              referrerName: ownRefName,
              profileAuthorized: true,
              onboardingCompleted: true,
            });
            setReferrerCode(ownRefCode);
            setReferrerName(ownRefName);
            setNickname(u.name || '');
            setPhone(u.phone || '');
            setEmail(u.email && !String(u.email).endsWith('@local.invalid') ? u.email : '');
          } else {
            // URL has ?ref=..., start in new member registration mode so B's link creates C
            setMember(null);
            setNickname('');
            setPhone('');
            setEmail('');
          }
        }
      }
    } catch {
      // ignore bootstrap error
    } finally {
      setBootstrapping(false);
    }
  }, [refFromUrl]);

  useEffect(() => {
    initExperience();
  }, [initExperience]);

  const handleAuthorizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSubmitting(true);

    try {
      // Existing logged-in WeChat members are profile updates; only referral links mint a new member.
      // 已登录会员（含打开自己推荐链接）一律为资料更新，不另建会员、不改推荐人
      const isNewRegistration = !member;
      const effectiveRefCode = (
        isNewRegistration
          ? (refFromUrl || referrerCode || 'RS-CN-SCOOT')
          : (member?.referrerCode || referrerCode || 'RS-CN-SCOOT')
      ).trim().toUpperCase();
      const postRes = await fetch('/api/auth/wechat/quick-login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-referral-code': effectiveRefCode,
        },
        body: JSON.stringify({
          nickname: nickname.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          referrerCode: effectiveRefCode,
          authorizeProfile: true,
          forceNew: isNewRegistration,
        }),
      });
      const postData = await postRes.json();
      if (!postRes.ok) {
        throw new Error(postData.error || '保存资料失败，请检查手机号或邮箱是否已被其他账号占用');
      }
      if (postData.user) {
        login(postData.user);
      }
      if (postData.member) {
        setMember(postData.member);
        if (postData.member.referrerCode) setReferrerCode(postData.member.referrerCode);
        if (postData.member.referrerName) setReferrerName(postData.member.referrerName);
      }
      setSuccessMsg('您的微信会员身份与专属推广链接已激活！');
      router.push('/cn/member');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!myShareLink) return;
    try {
      await navigator.clipboard.writeText(myShareLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // fallback
    }
  };

  const activeName = member?.name || (refFromUrl ? '' : user?.name) || '';
  const activeReferralCode = member?.referralCode || (refFromUrl ? '' : user?.referralCode) || '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#eaf6f0] via-[#f5faf7] to-white px-4 py-8">
      <div className="mx-auto max-w-xl space-y-6">
        {/* Header Card */}
        <div className="rounded-3xl bg-gradient-to-br from-[#07c160] via-[#06ad56] to-[#048848] p-6 text-white shadow-xl shadow-emerald-950/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-xs">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                微信一键极速体验通道
              </span>
              <h1 className="mt-2.5 text-2xl font-bold tracking-tight">
                糙米健康 · 微信尊享会员卡
              </h1>
              <p className="mt-1 text-xs text-emerald-50/90">
                免验证码 · 微信身份直通 · 自动激活您的专属推广码与分享海报
              </p>
            </div>
            <div className="hidden sm:flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-xs">
              <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current" aria-hidden="true">
                <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348z" />
              </svg>
            </div>
          </div>

          {/* Member Badge Summary */}
          <div className="mt-5 rounded-2xl bg-black/15 p-4 backdrop-blur-xs border border-white/15 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-emerald-100">当前会员身份</p>
              <p className="text-lg font-bold">
                {bootstrapping ? '正在同步安全状态...' : activeName || '未登录（填写下方资料一键激活）'}
              </p>
              <p className="mt-0.5 text-xs text-emerald-100/90">
                归属推荐人：{member?.referrerName || referrerName}（{member?.referrerCode || referrerCode}）
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-emerald-100">专属推广码</p>
              <p className="font-mono text-base font-bold tracking-wider bg-white/20 px-3 py-1 rounded-lg mt-0.5">
                {activeReferralCode || '激活后生成'}
              </p>
            </div>
          </div>
        </div>

        {/* Step 1: Authorize WeChat Nickname & Optional Contact Info */}
        <div className="rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#07c160]">
                STEP 1 · 微信资料授权确认
              </span>
              <h2 className="mt-0.5 text-lg font-bold text-slate-900">
                完善您的微信会员名片（免填验证码）
              </h2>
            </div>
            {member?.profileAuthorized && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                ✓ 已授权激活
              </span>
            )}
          </div>

          {successMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
              ✓ {successMsg}
            </div>
          )}

          <form onSubmit={handleAuthorizeSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  您的微信昵称 / 会员称呼 <span className="text-emerald-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="例如：林小姐 / 曹总"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#07c160] focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  联系手机号（选填，用于订单与奖励通知）
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="11位中国大陆手机号（免验证码）"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#07c160] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  电子邮箱（选填）
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="选填，便于接收电子账单"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#07c160] focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  绑定推荐人邀请码
                </label>
                <input
                  type="text"
                  value={referrerCode}
                  onChange={(e) => setReferrerCode(e.target.value.toUpperCase())}
                  placeholder="默认 RS-CN-SCOOT"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#07c160] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting || bootstrapping}
                className="flex-1 rounded-2xl bg-[#07c160] px-5 py-3.5 text-sm font-bold text-white shadow-md shadow-[#07c160]/20 hover:bg-[#06ad56] transition disabled:opacity-50"
              >
                {submitting ? '正在同步微信会员身份...' : '确认授权并保存会员资料'}
              </button>

              <button
                type="button"
                onClick={() => router.push(returnTo)}
                className="rounded-2xl border border-emerald-900/15 bg-emerald-50/70 px-5 py-3.5 text-sm font-bold text-emerald-950 hover:bg-emerald-100 transition"
              >
                直接进入会员中心 →
              </button>
            </div>
          </form>
        </div>

        {/* Step 2: Instant Share Link & QR Poster */}
        {myShareLink && (
          <div className="rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm space-y-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                STEP 2 · 您的专属微信裂变推广码
              </span>
              <h2 className="mt-0.5 text-lg font-bold text-slate-900">
                一键转发微信好友，扫码自动归属您的团队
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                好友打开下方链接或扫描二维码后，无需输入验证码即可一键成为您的下级会员。
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-900/10 bg-emerald-50/50 p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="truncate text-xs font-mono text-emerald-950 select-all">
                {myShareLink}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="rounded-xl bg-emerald-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 transition"
                >
                  {copiedLink ? '✓ 已复制链接' : '复制推广链接'}
                </button>
                <WechatShareButton referralCode={member?.referralCode} nickname={user?.name || member?.name} />
                <button
                  type="button"
                  onClick={() => setShowQrPreview(!showQrPreview)}
                  className="rounded-xl border border-emerald-900/20 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 transition"
                >
                  {showQrPreview ? '收起推广二维码' : '生成微信推广二维码'}
                </button>
              </div>
            </div>

            {showQrPreview && (
              <div className="mx-auto w-48">
                <ReferralQrCode value={myShareLink} />
              </div>
            )}

            {/* Quick Navigation Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <Link
                href="/cn/shop"
                className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 hover:border-emerald-700/30 hover:bg-emerald-50/30 transition"
              >
                <p className="text-xs font-bold text-emerald-800">01 · 商城选购</p>
                <p className="mt-1 text-sm font-bold text-slate-900">浏览糙米健康商城</p>
                <p className="mt-0.5 text-xs text-slate-500">支持微信支付与会员专享价</p>
              </Link>

              <Link
                href="/cn/member"
                className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 hover:border-emerald-700/30 hover:bg-emerald-50/30 transition"
              >
                <p className="text-xs font-bold text-emerald-800">02 · 会员中心</p>
                <p className="mt-1 text-sm font-bold text-slate-900">查看我的等级与权益</p>
                <p className="mt-0.5 text-xs text-slate-500">实时查看积分、订单与推广码</p>
              </Link>

              <Link
                href="/cn/member/share"
                className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 hover:border-emerald-700/30 hover:bg-emerald-50/30 transition"
              >
                <p className="text-xs font-bold text-emerald-800">03 · 推广工作台</p>
                <p className="mt-1 text-sm font-bold text-slate-900">生成高清分享海报</p>
                <p className="mt-0.5 text-xs text-slate-500">追踪扫码访客与下级团队收益</p>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CnExperiencePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#f4f7f4] text-emerald-900">
          正在加载微信极速体验通道...
        </div>
      }
    >
      <CnExperienceContent />
    </Suspense>
  );
}
