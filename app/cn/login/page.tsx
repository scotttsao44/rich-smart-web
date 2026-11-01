'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/providers';
import ReferralQrCode from '@/components/ReferralQrCode';
import PhoneLogin from './PhoneLogin';

const WECHAT_TEXT: Record<string, string> = {
  missing_code: '未获取到微信授权凭证，请重试。',
  invalid_state: '安全校验未通过（可能页面停留过久），请重新发起微信登录。',
  not_configured: '当前正在切换微信快捷通道，请稍后重试。',
  token_failed: '微信凭证换取失败，请检查公众号或开放平台配置。',
  userinfo_failed: '拉取微信昵称失败，请重试。',
  exception: '微信登录过程出现异常，请稍后重试。',
};

interface QuickLoginStatus {
  officialConfigured: boolean;
  openConfigured: boolean;
}

interface QrSessionState {
  sid: string;
  scanUrl: string;
  status: 'pending' | 'scanned' | 'confirmed' | 'expired';
  nickname?: string | null;
  expiresAt: number;
}

function CnLoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || searchParams.get('next') || '/cn/member';
  const refFromUrl = (searchParams.get('ref') || searchParams.get('referrer') || '').trim().toUpperCase();
  const wechatErr = searchParams.get('wechat_error') || '';

  const [wxConfig, setWxConfig] = useState<QuickLoginStatus | null>(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [referrerCode, setReferrerCode] = useState(refFromUrl);
  const [referrerName, setReferrerName] = useState('');
  const [showRefInput, setShowRefInput] = useState(Boolean(refFromUrl));

  // QR Session state for PC/Mobile scan
  const [qrSession, setQrSession] = useState<QrSessionState | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  // Secondary methods
  const [showPhoneAuth, setShowPhoneAuth] = useState(true);
  const [showPasswordAuth, setShowPasswordAuth] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isWeChatBrowser =
    typeof navigator !== 'undefined' && /micromessenger/i.test(navigator.userAgent || '');

  useEffect(() => {
    if (refFromUrl) {
      setReferrerCode(refFromUrl);
      setShowRefInput(true);
    }
    const query = refFromUrl ? `?ref=${encodeURIComponent(refFromUrl)}` : '';
    fetch(`/api/cn/referral-link/pending${query}`, { cache: 'no-store', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const resolvedCode = data?.referrerCode || data?.referredByCode;
        if (resolvedCode && (refFromUrl || !referrerCode)) {
          setReferrerCode(String(resolvedCode).toUpperCase());
        }
        if (data?.referrerName) {
          setReferrerName(String(data.referrerName));
        }
      })
      .catch(() => undefined);
  }, [refFromUrl]);

  // Clear any residual local WeChat device token on login page mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('rs_wx_device_token');
      } catch {
        // ignore storage errors
      }
    }
    fetch('/api/auth/wechat/quick-login', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: QuickLoginStatus) => {
        setWxConfig(data);
      })
      .catch(() => {
        setWxConfig({
          officialConfigured: false,
          openConfigured: false,
        });
      });
  }, []);

  const createQrCodeSession = useCallback(async () => {
    setQrLoading(true);
    try {
      const res = await fetch('/api/auth/wechat/qr-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          referrerCode: referrerCode.trim() || undefined,
          returnTo,
        }),
      });
      const data = await res.json();
      if (res.ok && data.sid) {
        setQrSession({
          sid: data.sid,
          scanUrl: data.scanUrl,
          status: 'pending',
          expiresAt: data.expiresAt,
        });
      }
    } catch {
      // ignore
    } finally {
      setQrLoading(false);
    }
  }, [referrerCode, returnTo]);

  useEffect(() => {
    createQrCodeSession();
  }, [createQrCodeSession]);

  // Poll QR session status every 2 seconds
  useEffect(() => {
    if (!qrSession?.sid || qrSession.status === 'confirmed' || qrSession.status === 'expired') {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/wechat/qr-session?sid=${encodeURIComponent(qrSession.sid)}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (data.status === 'confirmed' && data.user) {
          clearInterval(timer);
          setQrSession((prev) => (prev ? { ...prev, status: 'confirmed' } : prev));
          login(data.user);
          router.push(data.redirectTo || returnTo);
        } else if (data.status === 'scanned') {
          setQrSession((prev) =>
            prev ? { ...prev, status: 'scanned', nickname: data.nickname || prev.nickname } : prev,
          );
        } else if (data.status === 'expired') {
          setQrSession((prev) => (prev ? { ...prev, status: 'expired' } : prev));
        }
      } catch {
        // ignore transient network errors
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [qrSession?.sid, qrSession?.status, login, router, returnTo]);

  const handleWechatAuth = async () => {
    setError('');

    // If inside WeChat mobile browser and official OAuth is configured, use real OAuth redirect
    if (isWeChatBrowser && wxConfig?.officialConfigured) {
      const qs = new URLSearchParams();
      qs.set('returnTo', returnTo);
      if (referrerCode.trim()) qs.set('ref', referrerCode.trim());
      window.location.href = `/api/auth/wechat/official/start?${qs.toString()}`;
      return;
    }

    setWxLoading(true);
    try {
      const response = await fetch('/api/auth/wechat/quick-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrerCode: referrerCode.trim() || undefined,
          forceNew: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '微信授权登录失败，请稍后重试');
      }
      login(data.user);
      router.push(returnTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '微信授权登录失败，请稍后重试');
    } finally {
      setWxLoading(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          identifier,
          email: identifier,
          password,
          region: 'CN',
        }),
      });
      const rawText = await response.text();
      let data: { error?: string; message?: string; user?: Record<string, unknown> } = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error('账号或密码错误，请重新输入或使用手机验证码一键登录');
      }
      if (!response.ok) {
        throw new Error(data.error || data.message || '账号或密码错误，请重新输入或使用手机验证码一键登录');
      }
      const userData = data.user;
      if (userData) {
        login({ ...(userData as any), region: 'CN' });
      }
      router.push(returnTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '账号或密码错误，请重新输入或使用手机验证码一键登录');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f0f7f4] via-[#f7faf8] to-white px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-emerald-900/10 bg-white shadow-xl shadow-emerald-950/5 overflow-hidden">
        {/* Top Header */}
        <div className="bg-gradient-to-br from-[#07c160] via-[#06ad56] to-[#048848] px-6 py-6 text-white text-center relative">
          <div className="mx-auto mb-2.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm shadow-inner">
            <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current" aria-hidden="true">
              <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" />
            </svg>
          </div>
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-100 uppercase">
            糙米健康 · 中国区会员中心
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight">
            {isWeChatBrowser ? '微信官方一键授权登录' : '微信扫码 · 手机号 · 邮箱登录'}
          </h1>
          <p className="mt-1 text-xs text-emerald-50/90">
            {isWeChatBrowser
              ? '当前位于微信内，点击下方按钮即可直接获取您的微信身份登录'
              : '请使用手机微信扫描二维码，或使用下方手机号验证码 / 邮箱登录'}
          </p>
        </div>

        <div className="p-6 space-y-5">
          {wechatErr && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {WECHAT_TEXT[wechatErr] || `微信登录提示：${wechatErr}`}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Mode A: Mobile WeChat Built-in Browser -> Official 1-Click OAuth */}
          {isWeChatBrowser ? (
            <div className="rounded-2xl border-2 border-[#07c160]/30 bg-gradient-to-b from-emerald-50/60 to-white p-5 space-y-4">
              <div className="text-center space-y-1">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#07c160]/15 px-3 py-1 text-xs font-bold text-[#06ad56]">
                  <span className="h-2 w-2 rounded-full bg-[#07c160] animate-pulse" />
                  微信内置安全环境
                </span>
                <h2 className="text-base font-bold text-slate-900 pt-1">微信官方一键授权登录</h2>
                <p className="text-xs text-slate-600">
                  无需输入账号密码，直接授权您的微信身份进入会员中心
                </p>
              </div>

              <button
                type="button"
                onClick={handleWechatAuth}
                disabled={wxLoading}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[#07c160] px-5 py-4 text-base font-bold text-white shadow-lg shadow-[#07c160]/25 hover:bg-[#06ad56] active:scale-[0.99] transition disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                  <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348z" />
                </svg>
                {wxLoading ? '正在连接微信安全授权...' : '微信官方一键授权登录'}
              </button>
            </div>
          ) : (
            /* Mode B: Desktop / Non-WeChat Browser -> Clean Centered QR Code First */
            <div className="rounded-2xl border-2 border-[#07c160]/25 bg-gradient-to-b from-emerald-50/40 to-white p-5 text-center space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-900">
                  <span className="h-2 w-2 rounded-full bg-[#07c160] animate-pulse" />
                  手机微信扫二维码登录
                </span>
                <button
                  type="button"
                  onClick={createQrCodeSession}
                  disabled={qrLoading}
                  className="text-emerald-700 hover:text-emerald-900 font-semibold underline"
                >
                  {qrLoading ? '刷新中...' : '刷新二维码'}
                </button>
              </div>

              <div className="relative mx-auto w-52">
                {qrSession?.scanUrl ? (
                  <ReferralQrCode value={qrSession.scanUrl} />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-2xl border border-emerald-900/15 bg-white p-3 text-xs text-slate-400">
                    正在生成专属登录二维码...
                  </div>
                )}

                {qrSession?.status === 'scanned' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-emerald-950/85 p-4 text-white backdrop-blur-xs">
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#07c160] text-lg font-bold">
                      ✓
                    </div>
                    <p className="text-sm font-bold">手机已扫码</p>
                    <p className="mt-1 text-xs text-emerald-100">
                      请在手机微信上点击「允许登录」
                    </p>
                  </div>
                )}

                {qrSession?.status === 'expired' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-slate-900/80 p-4 text-white">
                    <p className="text-sm font-bold">二维码已过期</p>
                    <button
                      type="button"
                      onClick={createQrCodeSession}
                      className="mt-2 rounded-xl bg-[#07c160] px-4 py-1.5 text-xs font-bold text-white"
                    >
                      点击重新生成
                    </button>
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                请打开手机<span className="font-semibold text-emerald-800">微信「扫一扫」</span>扫描上方二维码，手机点「允许登录」后电脑将自动跳转
              </p>
            </div>
          )}

          {/* Optional Referrer Code */}
          {showRefInput ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-left">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">
                  推荐人邀请码（选填，不填默认归属官方直属）
                </label>
                {refFromUrl && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    已自动带入专属分享码
                  </span>
                )}
              </div>
              <input
                type="text"
                value={referrerCode}
                onChange={(e) => setReferrerCode(e.target.value.toUpperCase())}
                placeholder="例如 RS-CN-SCOOT"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[#07c160] focus:outline-none"
              />
            </div>
          ) : (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowRefInput(true)}
                className="text-xs text-slate-500 hover:text-emerald-700 underline"
              >
                有好友推荐码？点击填写
              </button>
            </div>
          )}

          {/* Divider */}
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-400">手机号验证码 / 邮箱登录</span>
            </div>
          </div>

          {/* Phone OTP Login / Register */}
          <div className="rounded-2xl border border-emerald-900/15 bg-slate-50/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">📱 手机号验证码一键登录 / 注册</span>
              <button
                type="button"
                onClick={() => setShowPhoneAuth(!showPhoneAuth)}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
              >
                {showPhoneAuth ? '收起' : '展开'}
              </button>
            </div>
            {showPhoneAuth && (
              <PhoneLogin
                returnTo={returnTo}
                referrerCode={referrerCode}
                referrerName={referrerName}
              />
            )}
          </div>

          {/* Email & Password Login Options */}
          <div className="grid grid-cols-2 gap-2.5">
            <Link
              href={`/cn/email?returnTo=${encodeURIComponent(returnTo)}${referrerCode ? `&ref=${encodeURIComponent(referrerCode)}` : ''}`}
              className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition text-center"
            >
              ✉️ 邮箱登录 / 注册
            </Link>
            <button
              type="button"
              onClick={() => setShowPasswordAuth(!showPasswordAuth)}
              className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
            >
              🔑 {showPasswordAuth ? '收起密码登录' : '账号密码登录'}
            </button>
          </div>

          {showPasswordAuth && (
            <form onSubmit={handlePasswordSubmit} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">手机号或邮箱</label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
                  placeholder="请输入已绑定的手机号或邮箱"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">登录密码</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
                  placeholder="请输入密码"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-emerald-900 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {loading ? '正在登录...' : '密码登录'}
              </button>
            </form>
          )}

          <div className="pt-1 flex items-center justify-between text-xs text-slate-500">
            <Link href="/cn/home" className="hover:text-emerald-800">
              ← 返回中国区首页
            </Link>
            <Link href="/cn/shop" className="hover:text-emerald-800 font-medium text-emerald-700">
              先去逛商城 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CnLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#f4f7f4] text-emerald-900">
          正在加载安全登录中心...
        </div>
      }
    >
      <CnLoginForm />
    </Suspense>
  );
}
