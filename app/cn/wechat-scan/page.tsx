'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/providers';

function WechatScanConfirmInner() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sid = (searchParams.get('sid') || '').trim();
  const refFromUrl = (searchParams.get('ref') || searchParams.get('referrer') || '').trim().toUpperCase();

  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [referrerCode, setReferrerCode] = useState<string>(refFromUrl);
  const [officialConfigured, setOfficialConfigured] = useState(false);
  const [status, setStatus] = useState<'ready' | 'confirming' | 'confirmed' | 'expired' | 'error'>('ready');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('rs_wx_device_token');
      } catch {
        // ignore
      }
    }
    if (!sid) return;
    fetch('/api/auth/wechat/qr-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'scan',
        sid,
        referrerCode: refFromUrl || undefined,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.session?.status === 'expired') {
          setStatus('expired');
          return;
        }
        setOfficialConfigured(Boolean(data.officialConfigured));
        if (data.officialConfigured && /micromessenger/i.test(navigator.userAgent || '')) {
          const qs = new URLSearchParams();
          qs.set('returnTo', `/cn/member?sid=${encodeURIComponent(sid)}`);
          const ref = String(data.referrerCode || refFromUrl || '').trim();
          if (ref) qs.set('ref', ref);
          window.location.replace(`/api/auth/wechat/official/start?${qs.toString()}`);
          return;
        }
        if (data.referrerName) setReferrerName(data.referrerName);
        if (data.referrerCode) setReferrerCode(data.referrerCode);
      })
      .catch(() => {
        // ignore
      });
  }, [sid, refFromUrl]);

  const handleConfirm = async () => {
    setErrorMessage('');
    setStatus('confirming');

    const isWeChatBrowser =
      typeof navigator !== 'undefined' && /micromessenger/i.test(navigator.userAgent || '');

    if (isWeChatBrowser) {
      // 真实公众号 OAuth：sid 放在 returnTo 内，回调据此确认电脑端扫码会话
      const qs = new URLSearchParams();
      qs.set('returnTo', sid ? `/cn/member?sid=${encodeURIComponent(sid)}` : '/cn/member');
      if (referrerCode) qs.set('ref', referrerCode);
      window.location.href = `/api/auth/wechat/official/start?${qs.toString()}`;
      return;
    }

    if (sid) {
      setStatus('error');
      setErrorMessage('请使用微信「扫一扫」扫描电脑上的二维码，并在微信内完成授权');
      return;
    }

    try {
      const res = await fetch('/api/auth/wechat/qr-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          sid: sid || undefined,
          referrerCode: referrerCode || undefined,
          forceNew: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '授权确认失败，请重试');
      }
      if (data.user) {
        login(data.user);
      }
      setStatus('confirmed');
      setTimeout(() => {
        router.push(data.redirectTo || '/cn/member');
      }, 900);
    } catch (err: unknown) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : '授权失败，请重试');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#07c160]/12 via-[#f4f8f5] to-white px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-sm rounded-3xl border border-emerald-900/10 bg-white shadow-xl shadow-emerald-950/10 overflow-hidden">
        <div className="bg-gradient-to-br from-[#07c160] to-[#059649] px-6 py-8 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-xs shadow-inner">
            <svg viewBox="0 0 24 24" className="h-9 w-9 fill-current" aria-hidden="true">
              <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348z" />
            </svg>
          </div>
          <p className="text-xs font-semibold tracking-widest text-emerald-100 uppercase">
            微信安全扫码授权
          </p>
          <h1 className="mt-1 text-xl font-bold">糙米健康 · 中国区会员中心</h1>
          <p className="mt-1.5 text-xs text-emerald-50/90">
            点击下方「允许登录」完成授权，电脑端将自动同步跳转
          </p>
        </div>

        <div className="p-6 space-y-5">
          {status === 'confirmed' ? (
            <div className="py-6 text-center space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-[#07c160]">
                ✓
              </div>
              <h2 className="text-lg font-bold text-slate-900">已允许登录</h2>
              <p className="text-xs text-slate-600">
                电脑端网页已同步登录，您也可以在手机上直接浏览会员中心...
              </p>
            </div>
          ) : status === 'expired' ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-base font-bold text-amber-800">二维码已过期</p>
              <p className="text-xs text-slate-600">请在电脑端登录页点击「刷新二维码」后重新扫描。</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-emerald-900/10 bg-emerald-50/50 p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#07c160] text-white font-bold text-base">
                    微
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500">即将授权登录</p>
                    <p className="text-sm font-bold text-slate-900 truncate">
                      微信安全授权登录
                    </p>
                    <p className="text-[11px] text-emerald-700 font-medium">
                      授权后自动同步微信身份并生成专属推广码
                    </p>
                  </div>
                </div>

                {referrerCode && (
                  <div className="pt-2 border-t border-emerald-900/10 flex items-center justify-between text-xs">
                    <span className="text-slate-500">归属推荐人：</span>
                    <span className="font-semibold text-emerald-800">
                      {referrerName ? `${referrerName} (${referrerCode})` : referrerCode}
                    </span>
                  </div>
                )}
              </div>

              {errorMessage && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {errorMessage}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={status === 'confirming'}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#07c160] px-5 py-4 text-base font-bold text-white shadow-lg shadow-[#07c160]/25 hover:bg-[#06ad56] active:scale-[0.99] transition disabled:opacity-60"
                >
                  {status === 'confirming' ? '正在确认授权...' : '允许登录'}
                </button>
              </div>

              <p className="text-center text-[11px] text-slate-400">
                授权后将同步开启您的专属会员与推广权益
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WechatScanConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#f4f8f5] text-emerald-900 text-sm">
          正在加载微信扫码确认页...
        </div>
      }
    >
      <WechatScanConfirmInner />
    </Suspense>
  );
}
