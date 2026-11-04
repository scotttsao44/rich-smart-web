'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, QrCode } from 'lucide-react';

type OwnerStatus = {
  eligible: boolean;
  bound: boolean;
  enabled: boolean;
  targets: Array<{ id: string; label: string; city: string; source: string }>;
  window: { open: boolean; label: string };
};

// 会员中心：店主／体验点负责人接收预约与线索通知（仅有资格的会员显示）
export default function StoreOwnerNotifyCard() {
  const [status, setStatus] = useState<OwnerStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [qrKey, setQrKey] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch('/api/cn/store-owner', { cache: 'no-store' }).catch(() => null);
    if (response?.ok) setStatus(await response.json());
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!showQr || status?.bound) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [showQr, status?.bound, load]);

  if (!status || !status.eligible) return null;

  const toggle = async (enabled: boolean) => {
    if (enabled && !status.bound) {
      setShowQr(true);
      setMessage('请先用微信扫码绑定「糙米量子」服务号，绑定后自动开启。');
      return;
    }
    setSaving(true);
    setMessage('');
    const response = await fetch('/api/cn/store-owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) setMessage(data.error || '设置失败');
    else {
      setStatus(data);
      setMessage(enabled ? '已开启，新的预约与线索会通过「糙米量子」服务号通知你。' : '已关闭店主通知。');
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-teal-100 bg-white p-5" data-testid="store-owner-notify">
      <div className="flex items-start gap-3">
        <BellRing className="mt-1 h-5 w-5 shrink-0 text-teal-700" />
        <div className="min-w-0 flex-1">
          <label className="flex cursor-pointer items-center gap-3 text-base font-black text-stone-950">
            <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={status.enabled} disabled={saving} onChange={(event) => toggle(event.target.checked)} />
            我是店主／体验点负责人，接收预约与线索通知
          </label>
          <div className="mt-2 text-sm font-semibold text-stone-600">
            负责：{status.targets.map((t) => `${t.label}${t.city ? `（${t.city}）` : ''}`).join('、')}
          </div>
          <div className="mt-1 text-sm font-semibold text-stone-500">
            服务号：{status.bound ? `已绑定 · ${status.window.label}` : '未绑定'}
          </div>
          {!status.bound ? (
            <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm font-semibold text-stone-700">
              <div>绑定方法：点「显示绑定二维码」，用微信扫码关注「糙米量子」服务号即自动绑定，绑定后即可开启。</div>
              {showQr ? (
                <div className="mt-3 flex flex-col items-start gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img key={qrKey} src={`/api/cn/store-owner/bind-qr?k=${qrKey}`} alt="糙米量子服务号绑定二维码" className="h-48 w-48 rounded border border-stone-200 bg-white" />
                  <button type="button" className="text-xs font-black text-teal-800" onClick={() => setQrKey((k) => k + 1)}>二维码 30 分钟内有效，过期点此刷新</button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowQr(true)} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 font-bold text-stone-800 hover:border-teal-500">
                  <QrCode className="h-4 w-4" />显示绑定二维码
                </button>
              )}
            </div>
          ) : null}
          {status.bound && !status.window.open ? (
            <div className="mt-2 text-xs font-semibold text-amber-700">提示：在服务号里发一句话（例如「收到」）即可保持消息畅通。</div>
          ) : null}
          {message ? <div className="mt-2 text-sm font-bold text-teal-800">{message}</div> : null}
        </div>
      </div>
    </section>
  );
}
