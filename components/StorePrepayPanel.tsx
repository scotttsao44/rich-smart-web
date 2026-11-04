'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, RefreshCw, X } from 'lucide-react';

// 门店申请：选择预购次数（次卡）档位并微信付款。档位金额只由登录后的接口返回。
type Tier = { id: string; amountYuan: number; uses: number };
type PrepayInfo = { tier: string; amountYuan: number; uses: number; status: 'unpaid' | 'paid'; orderNo: string; transactionId?: string; paidAt?: string; expiresAt?: string } | null;

declare global {
  interface Window {
    WeixinJSBridge?: { invoke: (name: string, params: Record<string, string>, cb: (res: { err_msg?: string }) => void) => void };
  }
}

function inWechatBrowser() {
  return typeof navigator !== 'undefined' && /micromessenger/i.test(navigator.userAgent);
}

function whenBridgeReady(): Promise<void> {
  return new Promise((resolve) => {
    if (window.WeixinJSBridge) return resolve();
    document.addEventListener('WeixinJSBridgeReady', () => resolve(), { once: true } as AddEventListenerOptions);
    setTimeout(() => resolve(), 4000);
  });
}

export function formatCnDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

export default function StorePrepayPanel({ applicationId, returnPath, onPaid, compact = false, initialTier = '' }: { applicationId: string; returnPath: string; onPaid?: () => void; compact?: boolean; initialTier?: string }) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [validMonths, setValidMonths] = useState(3);
  const [tier, setTier] = useState(initialTier);
  const [prepay, setPrepay] = useState<PrepayInfo>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoDone = useRef(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const paidNotified = useRef(false);
  const paid = prepay?.status === 'paid';

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPolling(false);
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const refresh = useCallback(async (silent = false) => {
    const res = await fetch(`/api/cn/store-applications/prepay?applicationId=${encodeURIComponent(applicationId)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!silent) setMessage(data.error || '读取付款状态失败');
      return false;
    }
    setTiers(data.tiers || []);
    setValidMonths(Number(data.validMonths || 3));
    setPrepay(data.prepay || null);
    if (data.prepay?.tier) setTier((t) => t || data.prepay.tier);
    if (data.paid) {
      setQr(null);
      stopPolling();
      setMessage('✅ 已付款，微信支付已确认到账');
      if (!paidNotified.current) { paidNotified.current = true; onPaidRef.current?.(); }
      return true;
    }
    if (!silent) setMessage('⏳ 暂未查到付款，如已付款请稍候再刷新');
    return false;
  }, [applicationId, stopPolling]);

  useEffect(() => { void refresh(true); }, [refresh]);

  const startPolling = useCallback(() => {
    stopPolling();
    setPolling(true);
    let count = 0;
    pollRef.current = setInterval(async () => {
      count += 1;
      const done = await refresh(true).catch(() => false);
      if (done || count >= 100) stopPolling();
    }, 3000);
  }, [refresh, stopPolling]);

  const pay = useCallback(async (tierId: string) => {
    if (!tierId) { setMessage('请先选择预购次数（次卡）档位'); return; }
    setBusy(true);
    setMessage('');
    try {
      const sep = returnPath.includes('?') ? '&' : '?';
      const res = await fetch('/api/cn/store-applications/prepay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, tier: tierId, returnTo: `${returnPath}${sep}payApp=${encodeURIComponent(applicationId)}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.alreadyPaid) { await refresh(); return; }
      if (data.needsOpenId && data.authUrl) {
        setMessage('正在获取微信支付授权…');
        window.location.href = data.authUrl;
        return;
      }
      if (!res.ok) { setMessage(data.error || data.message || '发起付款失败，请稍后再试'); return; }
      if (data.paymentType === 'jsapi' && data.paymentParams) {
        await whenBridgeReady();
        if (!window.WeixinJSBridge) { setMessage('未能调起微信支付，请在微信内打开本页面'); return; }
        window.WeixinJSBridge.invoke('getBrandWCPayRequest', data.paymentParams, (r) => {
          const msg = String(r?.err_msg || '');
          if (msg === 'get_brand_wcpay_request:ok') {
            setMessage('付款完成，正在确认到账…');
            startPolling();
            void refresh(true);
          } else if (msg === 'get_brand_wcpay_request:cancel') setMessage('已取消付款，可随时再次点击「去付款」');
          else setMessage(`微信支付未完成：${msg || '未知错误'}`);
        });
        return;
      }
      if (data.qrDataUrl) {
        setQr(data.qrDataUrl);
        setMessage(data.message || '请使用微信扫一扫完成付款');
        startPolling();
        return;
      }
      setMessage(data.message || '发起付款失败');
    } finally {
      setBusy(false);
    }
  }, [applicationId, returnPath, refresh, startPolling]);

  useEffect(() => {
    // 微信授权回跳 ?payApp=<id>&autopay=1（或 payError=…）时，自动续接付款
    if (typeof window === 'undefined' || autoDone.current || !tiers.length) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('payApp') !== applicationId) return;
    autoDone.current = true;
    if (q.get('payError')) { setMessage(`微信授权失败：${q.get('payError')}`); return; }
    if (q.get('autopay') === '1' && !paid && (prepay?.tier || tier)) void pay(prepay?.tier || tier);
  }, [tiers.length, applicationId, paid, prepay?.tier, tier, pay]);

  if (paid && prepay) {
    return (
      <div className={`rounded-xl border border-emerald-200 bg-emerald-50 ${compact ? 'p-3' : 'p-4'} text-sm`}>
        <div className="flex items-center gap-2 font-black text-emerald-800"><CheckCircle2 className="h-4 w-4" />预购次数（次卡）已付款</div>
        <div className="mt-2 grid gap-1 font-semibold text-emerald-900">
          <div>{prepay.tier} 档 · {prepay.uses} 次 · 有效期至 {formatCnDate(prepay.expiresAt)}</div>
          <div>订单号 {prepay.orderNo}{prepay.paidAt ? ` · 付款时间 ${new Date(prepay.paidAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` : ''}</div>
          <div className="text-xs text-emerald-700">平台审核并安排设备后，所购次数会灌入您的门店机器。退款或疑问请联系客服（转人工）。</div>
        </div>
      </div>
    );
  }

  const selected = tiers.find((t) => t.id === tier);
  return (
    <div className={`rounded-xl border border-amber-200 bg-amber-50/60 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="font-black text-stone-950">选择预购次数（次卡）并付款</div>
      <p className="mt-1 text-xs font-semibold leading-5 text-stone-600">每批次卡有效期 {validMonths} 个月（自付款日起）；平台审核并安排设备后，所购次数灌入门店机器。</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {tiers.map((t) => (
          <button key={t.id} type="button" onClick={() => setTier(t.id)} className={`rounded-lg border-2 bg-white p-3 text-left ${tier === t.id ? 'border-teal-600' : 'border-stone-200'}`}>
            <div className="text-xs font-black text-teal-700">{t.id} 档</div>
            <div className="mt-1 text-xl font-black tabular-nums text-stone-950">¥{t.amountYuan.toLocaleString('en-US')}</div>
            <div className="text-sm font-bold text-stone-700">{t.uses} 次 · {validMonths} 个月</div>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !selected} onClick={() => void pay(tier)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-600 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
          {selected ? `去付款 ¥${selected.amountYuan.toLocaleString('en-US')}` : '请先选择档位'}
        </button>
        <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-700">
          <RefreshCw className={`h-3.5 w-3.5 ${polling ? 'animate-spin' : ''}`} /> 我已付款，刷新状态
        </button>
      </div>
      {message ? <div className="mt-2 text-xs font-bold text-teal-800">{message}</div> : null}
      {qr ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setQr(null); stopPolling(); }}>
          <div className="relative w-full max-w-xs rounded-2xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="absolute right-3 top-3 text-stone-400" onClick={() => { setQr(null); stopPolling(); }} aria-label="关闭"><X className="h-5 w-5" /></button>
            <div className="text-base font-black text-stone-900">微信扫码付款</div>
            <div className="mt-1 text-xs text-stone-500">预购次数（次卡）{selected ? `${selected.id} 档 · ¥${selected.amountYuan.toLocaleString('en-US')}` : ''}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="微信支付二维码" className="mx-auto mt-3 h-56 w-56" />
            <div className="mt-2 text-xs text-stone-600">{inWechatBrowser() ? '长按二维码，选择「识别图中二维码」付款' : '请打开手机微信「扫一扫」完成付款'}</div>
            <div className="mt-2 flex items-center justify-center gap-1 text-xs font-bold text-emerald-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 付款后页面将自动更新</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
