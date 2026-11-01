'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, RefreshCw, X } from 'lucide-react';

export interface PayableOrder {
  id: number;
  orderNo?: string | null;
  totalAmount?: string | number | null;
  status?: string | null;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
}

declare global {
  interface Window {
    WeixinJSBridge?: { invoke: (name: string, params: Record<string, string>, cb: (res: { err_msg?: string }) => void) => void };
  }
}

export function isOrderUnpaid(order: PayableOrder) {
  return order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded' && order.status !== 'cancelled' && order.status !== 'paid' && order.status !== 'completed' && order.status !== 'shipped' && order.status !== 'delivered';
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

export default function OrderPayPanel({
  order,
  onOrderUpdated,
  autoPay = false,
  compact = false,
}: {
  order: PayableOrder;
  onOrderUpdated?: (order: PayableOrder) => void;
  autoPay?: boolean;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [paid, setPaid] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPayDone = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPolling(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const checkStatus = useCallback(async (silent = false) => {
    const res = await fetch('/api/payments/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.order) onOrderUpdated?.(data.order);
    if (data.paid) {
      setPaid(true);
      setQr(null);
      stopPolling();
      setMessage('✅ 已付款，微信支付已确认到账');
      return true;
    }
    if (!silent) {
      if (!res.ok) setMessage(data.error || '查询失败，请稍后再试');
      else setMessage(`⏳ 当前状态：${data.message || data.transaction?.trade_state_desc || '待付款'}`);
    }
    return false;
  }, [order.id, onOrderUpdated, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    setPolling(true);
    let count = 0;
    pollRef.current = setInterval(async () => {
      count += 1;
      const done = await checkStatus(true).catch(() => false);
      if (done || count >= 100) stopPolling();
    }, 3000);
  }, [checkStatus, stopPolling]);

  const payWechat = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/payments/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, provider: 'wechat_pay', returnTo: `/cn/orders?payOrder=${order.id}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.order) onOrderUpdated?.(data.order);
      if (data.alreadyPaid) {
        await checkStatus();
        return;
      }
      if (data.needsOpenId && data.authUrl) {
        setMessage('正在获取微信支付授权…');
        window.location.href = data.authUrl;
        return;
      }
      if (!res.ok) {
        setMessage(data.message || data.error || '发起付款失败，请稍后再试');
        return;
      }
      if (data.paymentType === 'jsapi' && data.paymentParams) {
        await whenBridgeReady();
        if (!window.WeixinJSBridge) {
          setMessage('未能调起微信支付，请在微信内打开本页面');
          return;
        }
        window.WeixinJSBridge.invoke('getBrandWCPayRequest', data.paymentParams, (r) => {
          const msg = String(r?.err_msg || '');
          if (msg === 'get_brand_wcpay_request:ok') {
            setMessage('付款完成，正在确认到账…');
            startPolling();
            void checkStatus(true);
          } else if (msg === 'get_brand_wcpay_request:cancel') {
            setMessage('已取消付款，可随时再次点击「去付款」');
          } else {
            setMessage(`微信支付未完成：${msg || '未知错误'}`);
          }
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
  }, [order.id, onOrderUpdated, checkStatus, startPolling]);

  useEffect(() => {
    // 微信授权回跳 /cn/orders?payOrder=<id>&autopay=1（或 payError=…）时，仅对该笔订单自动续接付款
    if (typeof window === 'undefined' || autoPayDone.current) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('payOrder') !== String(order.id)) return;
    if (q.get('payError')) { autoPayDone.current = true; setMessage(`微信授权失败：${q.get('payError')}`); return; }
    if (q.get('autopay') === '1' && isOrderUnpaid(order)) { autoPayDone.current = true; void payWechat(); }
  }, [order, payWechat]);

  useEffect(() => {
    if (autoPay && !autoPayDone.current && isOrderUnpaid(order)) {
      autoPayDone.current = true;
      void payWechat();
    }
  }, [autoPay, order, payWechat]);

  if (paid || !isOrderUnpaid(order)) {
    return paid ? (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
        <CheckCircle2 className="h-4 w-4" /> 已付款
      </div>
    ) : null;
  }

  return (
    <div className={`mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 ${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void payWechat()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-600 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            去付款 ¥{Number(order.totalAmount || 0).toFixed(2)}
          </button>
          <button
            type="button"
            onClick={() => void checkStatus()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${polling ? 'animate-spin' : ''}`} /> 我已付款，刷新状态
          </button>
        </div>

      {message ? <div className="mt-2 text-xs font-bold text-teal-800">{message}</div> : null}

      {qr ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setQr(null); stopPolling(); }}>
          <div className="relative w-full max-w-xs rounded-2xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="absolute right-3 top-3 text-stone-400" onClick={() => { setQr(null); stopPolling(); }} aria-label="关闭">
              <X className="h-5 w-5" />
            </button>
            <div className="text-base font-black text-stone-900">微信扫码付款</div>
            <div className="mt-1 text-xs text-stone-500">订单 {order.orderNo} · ¥{Number(order.totalAmount || 0).toFixed(2)}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="微信支付二维码" className="mx-auto mt-3 h-56 w-56" />
            <div className="mt-2 text-xs text-stone-600">
              {inWechatBrowser() ? '长按二维码，选择「识别图中二维码」付款' : '请打开手机微信「扫一扫」完成付款'}
            </div>
            <div className="mt-2 flex items-center justify-center gap-1 text-xs font-bold text-emerald-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 付款后页面将自动更新
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
