'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Mail, Loader2, Copy, Check } from 'lucide-react';
import { useAuth } from '@/app/providers';

type Referral = { pending: boolean; referrerName?: string };
export default function EmailMemberPage() {
  const router = useRouter();
  const { login, logout } = useAuth();
  const [user, setServerUser] = useState<ReturnType<typeof useAuth>['user']>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [referral, setReferral] = useState<Referral>({ pending: false });
  const [config, setConfig] = useState<{ registrationEnabled: boolean; loginEnabled: boolean } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmReferral, setConfirmReferral] = useState(true);
  const [pilotCodeHint, setPilotCodeHint] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [resetPassword, setResetPassword] = useState(false);
  useEffect(() => {
    if (!user) { setShareUrl(''); return; }
    fetch('/api/auth/email/referral', { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '邀请链接暂时不可用');
      setShareUrl(new URL(data.referralPath, window.location.origin).href);
    }).catch(failure => setError(failure.message));
  }, [user]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') === 'login') setMode('login');
    fetch('/api/auth/me', { cache: 'no-store' }).then(async response => {
      if (response.status === 401) return;
      if (!response.ok) throw new Error();
      const data = await response.json(); setServerUser(data.user);
    }).catch(() => setError('无法确认登录状态，请重新载入')).finally(() => setSessionReady(true));
    Promise.all([
      fetch('/api/auth/email', { cache: 'no-store' }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`/api/cn/referral-link/pending${window.location.search || ''}`, { cache: 'no-store' }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }),
    ]).then(([nextConfig, pending]) => { setConfig(nextConfig); setReferral(pending); })
      .catch(() => setError('暂时无法读取邮箱服务状态，请重新载入'));
  }, []);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [retryAt]);
  function changeMode(next: 'register' | 'login') { setMode(next); setResetPassword(false); setError(''); setMessage(''); setPassword(''); setConfirmPassword(''); setChallengeId(''); setCode(''); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(''); setMessage('');
    if ((mode === 'register' || resetPassword) && !challengeId && password !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      const action = challengeId ? 'verify' : resetPassword ? 'reset' : mode === 'login' ? 'login' : 'request';
      const response = await fetch('/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'verify' ? { action, challengeId, code } : { action, email, name, password, confirmReferral }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试');
      if (action === 'request' || action === 'reset') { setChallengeId(data.challengeId); if (data.pilotCode) { setCode(String(data.pilotCode)); setPilotCodeHint(String(data.pilotCode)); } setPassword(''); setConfirmPassword(''); setMessage(data.message); setRetryAt(Date.now() + 60000); }
      else { login(data.user); setServerUser(data.user); if (action === 'login') router.replace('/cn/member'); else { setMessage(resetPassword ? '密码已更新，请使用新密码登录其他设备' : '邮箱已验证，会员已建立'); setChallengeId(''); setCode(''); } }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败，请稍后重试'); }
    finally { setBusy(false); }
  }
  const registration = mode === 'register';
  const emailChallenge = registration || resetPassword;
  const enabled = emailChallenge ? config?.registrationEnabled : config?.loginEnabled;
  const inputClass = 'mt-2 block w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-base text-stone-950 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100';
  return (
    <main className="min-h-screen bg-[var(--caomi-page)] px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <Link href="/cn/login" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600"><ArrowLeft size={16} />返回登录</Link>
        <header className="mb-7 mt-6 flex items-center gap-3">
          <Image src="/images/caomi-logo.png" alt="糙米" width={64} height={64} className="h-14 w-14 object-contain" />
          <h1 className="text-2xl font-bold text-stone-950">{resetPassword ? '重设密码' : registration ? '邮箱注册' : '邮箱登录'}</h1>
        </header>
        {!sessionReady ? <p role="status" className="text-sm text-stone-600">正在确认登录状态</p> : <>
          {user ? (
            <div className="mb-6 space-y-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-stone-900">当前已登录：{user.name}</p>
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <Link href="/cn/member" className="text-teal-800 underline">进入会员中心</Link>
                  <button type="button" onClick={async () => { if (await logout()) setServerUser(null); else setError('退出失败，请稍后重试'); }} className="text-stone-600 hover:text-stone-900">退出当前账号</button>
                </div>
              </div>
              {shareUrl ? (
                <div className="space-y-1.5">
                  <label htmlFor="email-share-link" className="text-xs font-semibold text-stone-700">我的会员邀请链接</label>
                  <div className="flex min-w-0 gap-2">
                    <input id="email-share-link" readOnly value={shareUrl} className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs" />
                    <button type="button" title={copied ? '已复制' : '复制邀请链接'} aria-label={copied ? '已复制' : '复制邀请链接'} onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setCopied(true); } catch { setError('复制失败，请从链接栏选取复制'); } }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-teal-700 bg-white text-teal-800">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-teal-900">无需先退出当前账号，您也可以直接在下方注册新会员或登录其他账号（将自动切换）。</p>
            </div>
          ) : null}
          <div className="mb-6 grid grid-cols-2 border-b border-stone-200" role="tablist" aria-label="邮箱账号">
            {(['register', 'login'] as const).map(value => <button key={value} role="tab" aria-selected={mode === value} disabled={busy} onClick={() => changeMode(value)} className={`min-h-12 border-b-2 px-3 font-semibold ${mode === value ? 'border-teal-800 text-teal-900' : 'border-transparent text-stone-500'}`}>{value === 'register' ? '注册会员' : '已有账号'}</button>)}
          </div>
          {config && !enabled ? <p role="status" className="mb-5 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">{registration ? '邮箱注册尚未开放，寄信服务配置中。' : '邮箱登录暂未开放。'}</p> : null}
          {registration && !challengeId ? <div className="mb-5 border-b border-stone-200 pb-5 text-sm">{referral.pending ? <><p className="font-semibold text-stone-900">邀请人：{referral.referrerName || '会员'}</p><label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={confirmReferral} onChange={event => setConfirmReferral(event.target.checked)} className="mt-1 h-4 w-4 accent-teal-800" />确认由此邀请人注册</label></> : <p className="text-stone-600">请先打开邀请人分享的会员邀请链接。</p>}</div> : null}
          <form onSubmit={submit} className="space-y-4">
            {emailChallenge && challengeId ? <>
              <p className="break-all text-sm text-stone-700">验证码已发送至 {email}</p>
              {pilotCodeHint ? (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
                  <p className="font-semibold">过渡测试期快捷验证</p>
                  <p className="mt-1">您的 6 位数字验证码为：<strong className="font-mono text-base tracking-widest text-emerald-900">{pilotCodeHint}</strong>（已自动填入下方输入框，请直接点击「验证并建立会员」）</p>
                </div>
              ) : null}
              <label className="block text-sm font-semibold">邮箱验证码<input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" maxLength={6} required className={inputClass} /></label>
              <button type="button" disabled={busy || seconds > 0} onClick={() => { setChallengeId(''); setCode(''); setMessage(''); }} className="text-sm font-semibold text-teal-800 disabled:text-stone-400">{seconds ? `${seconds} 秒后可重新申请` : '修改资料或重新申请验证码'}</button>
            </> : <>
              {registration ? <label className="block text-sm font-semibold">姓名<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required className={inputClass} /></label> : null}
              <label className="block text-sm font-semibold">电子邮箱<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required className={inputClass} /></label>
              <label className="block text-sm font-semibold">{emailChallenge ? '设置密码（至少12位）' : '密码'}<input type="password" autoComplete={emailChallenge ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={emailChallenge ? 12 : 1} maxLength={128} required className={inputClass} /></label>
              {emailChallenge ? <label className="block text-sm font-semibold">确认密码<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} required className={inputClass} /></label> : null}
            </>}
            <button disabled={busy || !enabled || (registration && !challengeId && (!referral.pending || !confirmReferral))} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 py-3 font-semibold text-white hover:bg-teal-900 disabled:opacity-50">{busy ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}{busy ? '处理中' : emailChallenge ? challengeId ? resetPassword ? '验证并更新密码' : '验证并建立会员' : '发送邮箱验证码' : '登录'}{!busy ? <ArrowRight size={16} /> : null}</button>
            {!registration && !challengeId ? <button type="button" disabled={busy} onClick={() => { setResetPassword(!resetPassword); setPassword(''); setConfirmPassword(''); setError(''); }} className="text-sm font-semibold text-teal-800">{resetPassword ? '返回密码登录' : '忘记密码'}</button> : null}
          </form>
        </>}
        {message ? <p role="status" className="mt-4 text-sm text-teal-800">{message}</p> : null}
        {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
      </div>
    </main>
  );
}
