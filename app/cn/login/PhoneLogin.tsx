'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Loader2, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAuth } from '@/app/providers';

export default function PhoneLogin({
  returnTo = '/cn/member',
  referrerCode = '',
  referrerName = '',
}: {
  returnTo?: string;
  referrerCode?: string;
  referrerName?: string;
}) {
  const router = useRouter();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [pilotCode, setPilotCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  async function handleSendCode() {
    if (sending || countdown > 0) return;
    setError('');
    setMessage('');
    if (!phone.trim()) {
      setError('请先输入手机号码（支持大陆 11 位或台湾 09 开头手机号）');
      return;
    }
    setSending(true);
    try {
      const response = await fetch('/api/auth/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '验证码发送失败');
      }
      setChallengeId(String(data.challengeId || ''));
      setCountdown(60);
      if (data.pilotCode) {
        setPilotCode(String(data.pilotCode));
        setCode(String(data.pilotCode));
      }
      setMessage(String(data.message || '验证码已发送'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    if (verifying) return;
    setError('');
    setMessage('');
    if (!phone.trim() || !code.trim()) {
      setError('请填写手机号与 6 位数字验证码');
      return;
    }
    setVerifying(true);
    try {
      const response = await fetch('/api/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(),
          code: code.trim(),
          challengeId,
          nickname: nickname.trim() || undefined,
          referrerCode: referrerCode || undefined,
          next: returnTo,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '手机号验证失败');
      }
      if (data.user) {
        login(data.user);
      }
      router.replace(data.redirectTo || returnTo || '/cn/member');
    } catch (err) {
      setError(err instanceof Error ? err.message : '手机号验证失败');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-800">
            <Phone size={18} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-stone-950">手机号码验证登录</h2>
            <p className="text-xs text-stone-500">支持大陆 11 位或台湾 10 位手机号 · 新手机号自动注册并绑定推荐人</p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          已开放实测
        </span>
      </div>

      {referrerName ? (
        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
          当前绑定邀请人：<strong className="text-stone-950">{referrerName}</strong>
          {referrerCode ? <span className="ml-2 font-mono text-stone-500">({referrerCode})</span> : null}
        </div>
      ) : null}

      <form onSubmit={handleVerify} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cn-phone-login-input" className="block text-sm font-semibold text-stone-800">
              手机号码
            </label>
            <input
              id="cn-phone-login-input"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="例如 13800138000 或 0912345678"
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-950 outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label htmlFor="cn-phone-nickname-input" className="block text-sm font-semibold text-stone-800">
              会员昵称（选填）
            </label>
            <input
              id="cn-phone-nickname-input"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="首次登录可填写您的称呼"
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-950 outline-none focus:border-teal-700"
            />
          </div>
        </div>

        <div>
          <label htmlFor="cn-phone-code-input" className="block text-sm font-semibold text-stone-800">
            短信验证码（6 位数字）
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="cn-phone-code-input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="请输入 6 位验证码"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm tracking-widest text-stone-950 outline-none focus:border-teal-700"
            />
            <button
              type="button"
              disabled={sending || countdown > 0}
              onClick={handleSendCode}
              className="shrink-0 rounded-lg border border-teal-700 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"
            >
              {sending ? '发送中...' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
            </button>
          </div>
        </div>

        {pilotCode ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-950">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
            <div>
              <p className="font-semibold">过渡测试期即时验证码已就绪</p>
              <p className="mt-0.5">
                本次验证码：<strong className="font-mono text-sm tracking-wider">{pilotCode}</strong>（已自动填入，直接点击下方按钮即可完成验证登录）
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}
        {message && !pilotCode ? (
          <p role="status" className="text-xs font-medium text-teal-800">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={verifying || !phone.trim() || code.length !== 6}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
        >
          {verifying ? <Loader2 size={16} className="animate-spin" /> : null}
          {verifying ? '验证登录中...' : '手机号验证登录'}
          {!verifying ? <ArrowRight size={16} /> : null}
        </button>
      </form>
    </div>
  );
}
