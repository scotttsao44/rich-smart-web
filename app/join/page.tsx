'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BadgePercent,
  HeartPulse,
  MessageCircle,
  Share2,
  Sparkles,
  UserPlus,
} from 'lucide-react';

export default function JoinByReferralPage() {
  const [origin, setOrigin] = useState('');
  const [referralCode, setReferralCode] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cleaned = (params.get('ref') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    setOrigin(window.location.origin);
    setReferralCode(cleaned);
    if (cleaned) {
      localStorage.setItem('richsmart_referral_code', cleaned);
    }
  }, []);

  const refQuery = referralCode ? `&ref=${encodeURIComponent(referralCode)}` : '';
  const registerQuery = referralCode ? `?ref=${encodeURIComponent(referralCode)}` : '';

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-teal-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 rounded-[2rem] border border-amber-100 bg-white/90 p-6 shadow-sm md:p-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-2 text-sm font-bold text-amber-700">
            <Sparkles size={16} />
            推荐码已带入：{referralCode || '尚未带入'}
          </div>
          <h1 className="max-w-3xl text-3xl font-black tracking-tight text-slate-950 md:text-5xl">
            歡迎加入糙米，先完成 LINE / 微信绑定，推荐奖金才不会断鏈。
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            朋友分享给您的链接已带有推荐码。请依所在地选择 LINE 或微信授权，系统会自动把推荐人写入会员资料，之后购买商品、申请代理、推荐朋友都能正确计算。
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-5">
              <Share2 className="mb-3 text-amber-600" />
              <h2 className="font-black text-slate-950">1. 推荐码进站</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">从朋友的专屬链接进入，系统先记住推荐码。</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <MessageCircle className="mb-3 text-green-600" />
              <h2 className="font-black text-slate-950">2. 加入商家客服</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">台湾走 LINE，大陆走微信公众号，授权后完成身份绑定。</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <BadgePercent className="mb-3 text-blue-600" />
              <h2 className="font-black text-slate-950">3. 购买与推荐</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">会员也能生成自己的推荐链接，申请代理后可查看佣金与团队。</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black text-slate-950">选择您的绑定方式</h2>
            <p className="mt-2 text-slate-600">这一步会把推荐码写入会员资料，比直接填表更安全。</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <a
                href={`/api/auth/line/start?returnTo=/portal${refQuery}`}
                className="rounded-2xl border border-green-200 bg-green-50 p-5 font-bold text-green-700 transition hover:bg-green-100"
              >
                <MessageCircle className="mb-3" />
                台湾 / LINE 登录绑定
                <span className="mt-2 block text-sm font-medium text-green-700/80">推荐码会跟著 LINE 授权一起提交。</span>
              </a>
              <a
                href={`/api/auth/wechat/start?returnTo=/portal${refQuery}`}
                className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 font-bold text-emerald-700 transition hover:bg-emerald-100"
              >
                <MessageCircle className="mb-3" />
                大陆 / 微信公众号绑定
                <span className="mt-2 block text-sm font-medium text-emerald-700/80">关注公众号后完成会员授权。</span>
              </a>
            </div>
            <div className="mt-5 rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              如果您不能使用 LINE / 微信授权，也可以先注册账号；只要这个页面带有推荐码，系统一樣会尝试绑定推荐人。
            </div>
            <Link
              href={`/register${registerQuery}`}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-bold text-white hover:bg-slate-800"
            >
              <UserPlus size={18} />
              手动注册会员
            </Link>
          </section>

          <section className="rounded-[2rem] border border-teal-100 bg-teal-950 p-6 text-white shadow-sm">
            <HeartPulse className="mb-4 text-teal-200" size={32} />
            <h2 className="text-2xl font-black">1+1 &gt; 3 智能养生流程</h2>
            <p className="mt-4 leading-7 text-teal-50">
              加入后，CRM 会从您的体验健康数据开始，依状态推荐保养方向、适合产品与最近体验网点。
            </p>
            <div className="mt-6 space-y-3 text-sm text-teal-50">
              <p className="rounded-2xl bg-white/10 p-4">上传或填写体验健康数据</p>
              <p className="rounded-2xl bg-white/10 p-4">智能推荐商城产品与保养组合</p>
              <p className="rounded-2xl bg-white/10 p-4">引导到最近网点体验仪器，促成购买与分享</p>
            </div>
            {origin && referralCode && (
              <p className="mt-6 break-all rounded-2xl bg-white/10 p-4 text-xs text-teal-100">
                本次入口：{origin}/join?ref={referralCode}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
