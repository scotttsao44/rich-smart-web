'use client';

import { useCallback, useEffect, useState } from 'react';
import ReferralQrCode from '@/components/ReferralQrCode';

// 电脑端「微信扫码验证管理员」：复用会员扫码登录的 qr-session（create → 显示二维码 → 每 2 秒轮询）
type Status = 'loading' | 'pending' | 'scanned' | 'denied' | 'expired' | 'confirmed' | 'error';

export default function AdminWechatScan({ next }: { next: string }) {
  const [sid, setSid] = useState('');
  const [scanUrl, setScanUrl] = useState('');
  const [status, setStatus] = useState<Status>('loading');

  const create = useCallback(async () => {
    setStatus('loading');
    setSid('');
    try {
      const res = await fetch('/api/auth/wechat/qr-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', purpose: 'admin', returnTo: next }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sid) throw new Error();
      setSid(data.sid);
      setScanUrl(data.scanUrl);
      setStatus('pending');
    } catch {
      setStatus('error');
    }
  }, [next]);

  useEffect(() => { create(); }, [create]);

  useEffect(() => {
    if (!sid || !['pending', 'scanned'].includes(status)) return;
    let stopped = false;
    let inFlight = false;
    const pollOnce = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/auth/wechat/qr-session?sid=${encodeURIComponent(sid)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (stopped) return;
        if (data.status === 'confirmed') { stopped = true; setStatus('confirmed'); window.location.assign(data.redirectTo || next); }
        else if (data.status === 'scanned' || data.status === 'denied' || data.status === 'expired') setStatus(data.status);
      } catch {
        // 网络抖动：下次轮询重试
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(pollOnce, 2000);
    const onVisible = () => { if (document.visibilityState === 'visible') void pollOnce(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [sid, status, next]);

  const text: Record<Status, string> = {
    loading: '正在生成二维码…',
    pending: '请用微信「扫一扫」扫码验证管理员身份',
    scanned: '已扫码，请在手机上完成验证…',
    confirmed: '验证成功，正在进入后台…',
    denied: '无管理员权限：该微信不在管理员名单内',
    expired: '二维码已过期',
    error: '二维码生成失败',
  };

  return (
    <div className="flex flex-col items-center gap-3 text-center" data-testid="admin-wechat-scan" data-status={status}>
      <div className="w-48">
        {scanUrl && status !== 'expired' && status !== 'denied' && status !== 'error' ? <ReferralQrCode value={scanUrl} /> : (
          <div className="flex aspect-square items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-sm font-bold text-stone-500">{status === 'loading' ? '生成中' : '—'}</div>
        )}
      </div>
      <p data-testid="admin-scan-status" className={`text-sm font-bold ${status === 'denied' || status === 'error' ? 'text-red-700' : status === 'confirmed' ? 'text-teal-800' : 'text-stone-700'}`}>{text[status]}</p>
      {['denied', 'expired', 'error'].includes(status) ? (
        <button type="button" onClick={create} className="rounded-lg border border-teal-600 px-3 py-1.5 text-sm font-bold text-teal-800">刷新二维码</button>
      ) : null}
    </div>
  );
}
