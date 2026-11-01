'use client';

import { useEffect, useState } from 'react';

type WxApi = {
  config: (cfg: Record<string, unknown>) => void;
  ready: (fn: () => void) => void;
  error: (fn: (err: unknown) => void) => void;
  updateAppMessageShareData: (data: Record<string, unknown>) => void;
  updateTimelineShareData: (data: Record<string, unknown>) => void;
};

const SHARE_ORIGIN = 'https://rich-smart.com.cn';
const SHARE_IMAGE = `${SHARE_ORIGIN}/images/caomi-logo.png`;
const SHARE_DESC = '糙米健康｜好产品、好服务，邀您一起体验健康生活。';

function loadJweixin(): Promise<WxApi | null> {
  const w = window as unknown as { wx?: WxApi };
  if (w.wx) return Promise.resolve(w.wx);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
    script.async = true;
    script.onload = () => resolve(w.wx || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

// 微信内配置分享卡片（失败时静默，不影响页面），并提供「一键分享给微信好友」引导遮罩
export default function WechatShareButton({ referralCode, nickname }: { referralCode?: string | null; nickname?: string | null }) {
  const [showGuide, setShowGuide] = useState(false);
  const code = String(referralCode || '').trim();

  useEffect(() => {
    if (!code || typeof window === 'undefined') return;
    if (!/micromessenger/i.test(navigator.userAgent)) return;
    let cancelled = false;
    (async () => {
      try {
        const pageUrl = window.location.href.split('#')[0];
        const res = await fetch(`/api/wechat/jssdk-config?url=${encodeURIComponent(pageUrl)}`, { cache: 'no-store' });
        const cfg = await res.json().catch(() => null);
        if (!cfg?.ok || cancelled) return;
        const wx = await loadJweixin();
        if (!wx || cancelled) return;
        const share = {
          title: `${String(nickname || '').trim() || '好友'} 邀您体验糙米健康`,
          desc: SHARE_DESC,
          link: `${SHARE_ORIGIN}/cn?ref=${encodeURIComponent(code)}`,
          imgUrl: SHARE_IMAGE,
        };
        wx.config({
          debug: false,
          appId: cfg.appId,
          timestamp: cfg.timestamp,
          nonceStr: cfg.nonceStr,
          signature: cfg.signature,
          jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData'],
        });
        wx.ready(() => {
          wx.updateAppMessageShareData(share);
          wx.updateTimelineShareData({ title: share.title, link: share.link, imgUrl: share.imgUrl });
        });
        wx.error(() => {
          // 签名或白名单未就绪时静默失败
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, nickname]);

  if (!code) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#07C160] px-4 py-2 text-xs font-bold text-white hover:bg-[#06ad56]"
      >
        一键分享给微信好友
      </button>
      {showGuide ? (
        <div
          role="dialog"
          onClick={() => setShowGuide(false)}
          className="fixed inset-0 z-[100] bg-black/75"
        >
          <svg className="absolute right-5 top-2 h-28 w-24" viewBox="0 0 96 112" fill="none" aria-hidden="true">
            <path d="M14 106 C 20 60, 50 34, 82 14" stroke="white" strokeWidth="4" strokeLinecap="round" />
            <path d="M62 10 L 84 12 L 78 34" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="absolute right-6 top-32 max-w-[80%] text-right text-lg font-black leading-8 text-white">
            点右上角 ··· → 发送给朋友
          </div>
        </div>
      ) : null}
    </>
  );
}
