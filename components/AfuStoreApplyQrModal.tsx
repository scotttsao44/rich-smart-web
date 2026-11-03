'use client';

import { useEffect, useState } from 'react';
import { MessageCircle, Phone, QrCode, X } from 'lucide-react';

// /cn/afu 的「扫码 / 联系客服」弹窗：沿用门店申请导览页同一个服务号带参二维码 API（/api/cn/wechat/store-apply-qr），
// 带 ?ref= 时二维码场景值归属推荐人；微信内已关注者可直接让服务号发来门店申请问题。逻辑与 StoreApplicationGuidePage 一致。
const STORE_APPLY_QR_API = '/api/cn/wechat/store-apply-qr';
const WECHAT_OFFICIAL_NAME = '糙米量子';

type FollowerState = 'unknown' | 'yes' | 'sending' | 'sent' | 'failed';

export default function AfuStoreApplyQrModal({ label, phone, className }: { label: string; phone: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [qrSrc, setQrSrc] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const [follower, setFollower] = useState<FollowerState>('unknown');

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get('ref') || params.get('r') || params.get('referrerCode') || '').trim();
    setQrSrc(`${STORE_APPLY_QR_API}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    if (!/MicroMessenger/i.test(navigator.userAgent) || follower !== 'unknown') return;
    let cancelled = false;
    fetch(`${STORE_APPLY_QR_API}?status=1`, { cache: 'no-store', credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.follower === true) setFollower('yes'); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, follower]);

  async function sendApplyTemplate() {
    setFollower('sending');
    try {
      const res = await fetch(STORE_APPLY_QR_API, { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      setFollower(data?.sent ? 'sent' : 'failed');
    } catch {
      setFollower('failed');
    }
  }

  function backToWechat() {
    const bridge = (window as unknown as { WeixinJSBridge?: { invoke: (name: string, args: object, cb?: () => void) => void } }).WeixinJSBridge;
    if (bridge) bridge.invoke('closeWindow', {});
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <QrCode className="h-5 w-5" />
        {label}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-stone-950/55 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="联系糙米量子客服">
          <div className="max-h-[92svh] w-full overflow-auto rounded-t-lg bg-white p-5 shadow-xl sm:max-w-md sm:rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-stone-950">申请门店合作</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">长按识别二维码关注「{WECHAT_OFFICIAL_NAME}」服务号，或拨打客服电话。客服会协助确认次卡档位、场地与后续安排。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4">
              {follower === 'yes' || follower === 'sending' || follower === 'sent' ? (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-center">
                  {follower === 'sent' ? (
                    <>
                      <p role="status" className="text-sm font-bold leading-6 text-teal-900">已发到「{WECHAT_OFFICIAL_NAME}」服务号，请回到微信对话列表打开「{WECHAT_OFFICIAL_NAME}」，按提示一条消息回复即可。</p>
                      <button type="button" onClick={backToWechat} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 font-black text-white"><MessageCircle className="h-5 w-5" />返回微信</button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold leading-6 text-teal-900">您已关注「{WECHAT_OFFICIAL_NAME}」，点下面按钮，服务号会直接发来门店申请问题。</p>
                      <button type="button" disabled={follower === 'sending'} onClick={sendApplyTemplate} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 font-black text-white disabled:opacity-60"><MessageCircle className="h-5 w-5" />{follower === 'sending' ? '发送中…' : '到服务号填写门店申请'}</button>
                    </>
                  )}
                </div>
              ) : !qrFailed && qrSrc ? (
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrSrc} alt={`${WECHAT_OFFICIAL_NAME} 门店申请二维码`} onError={() => setQrFailed(true)} className="mx-auto aspect-square w-56 max-w-full rounded-lg border border-stone-200 object-contain p-2" />
                  <p className="mt-2 text-xs font-bold leading-5 text-stone-600">{follower === 'failed' ? '没能直接发送，请长按识别二维码进入服务号。' : '长按识别二维码，关注后服务号会自动发来门店申请问题。'}</p>
                </div>
              ) : !qrSrc ? (
                <div className="mx-auto aspect-square w-56 max-w-full animate-pulse rounded-lg bg-stone-100" />
              ) : (
                <p role="status" className="text-sm font-semibold text-stone-600">二维码暂时无法载入，请在微信搜索「{WECHAT_OFFICIAL_NAME}」，或拨打客服电话。</p>
              )}
              <div className="rounded-lg bg-stone-50 p-4 text-sm font-bold leading-7 text-stone-700">
                <div>微信服务号：<span className="text-stone-950">{WECHAT_OFFICIAL_NAME}</span></div>
                <div>客服电话：<a href={`tel:${phone}`} className="inline-flex items-center gap-1 text-teal-700"><Phone className="h-4 w-4" />{phone}</a></div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-stone-300 px-4 py-2 font-black text-stone-800">关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
