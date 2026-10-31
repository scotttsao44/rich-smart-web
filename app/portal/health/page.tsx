'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  ArrowLeft,
  HeartPulse,
  MapPin,
  ShoppingBag,
  Sparkles,
  Upload,
} from 'lucide-react';

const recommendedPlans = [
  {
    title: '基礎循環保养',
    reason: '适合初次体验者，先建立每日补水、睡眠与循環節奏。',
    action: '建议先到最近网点体验设备，再搭配商城基礎保养商品。',
  },
  {
    title: '1+1 > 3 加强方案',
    reason: '若体验后出现疲劳、循環或睡眠相关回馈，可安排第二次追踪。',
    action: '由门店协助记录数据，CRM 再推荐合适产品与回访时间。',
  },
  {
    title: '家庭分享方案',
    reason: '会员可把体验结果与推荐链接分享给家人朋友，形成健康社群。',
    action: '使用您的推荐码邀请加入，完成 LINE / 微信绑定后计入团队。',
  },
];

export default function HealthDataPage() {
  const { user } = useAuth();
  const [submitted, setSubmitted] = useState(false);

  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h2 className="mb-4 text-xl font-semibold text-gray-700">请先登录</h2>
        <p className="mb-6 text-gray-500">登录后才能建立健康数据与推荐方案。</p>
        <Link href="/login" className="btn-primary">前往登录</Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <Link href="/portal" className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900">
          <ArrowLeft size={18} />
          返回会员中心
        </Link>
      </div>

      <section className="mb-6 rounded-[2rem] border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-100 px-3 py-1 text-sm font-bold text-teal-700">
              <HeartPulse size={16} />
              智能健康 CRM
            </div>
            <h1 className="text-3xl font-black text-slate-950">上传体验健康数据，启动 1+1 &gt; 3 保养推荐</h1>
            <p className="mt-3 max-w-3xl leading-7 text-slate-600">
              这里先做成 MVP：会员可留下体验记录、上传照片或报告，系统先给出保养方向、商城入口与最近网点。后续再接 AI 判读与完整报表。
            </p>
          </div>
          <Sparkles className="hidden text-teal-300 md:block" size={64} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <form
          className="card space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
          }}
        >
          <h2 className="text-xl font-black text-slate-950">新增体验记录</h2>
          <div>
            <label className="label">体验门店 / 网点</label>
            <input className="input-field" placeholder="例如：德吉正源养生保健馆" />
          </div>
          <div>
            <label className="label">主要感受或问题</label>
            <textarea
              className="input-field min-h-32"
              placeholder="例如：睡眠、疲劳、循環、肩颈、体验后改善感受..."
            />
          </div>
          <div>
            <label className="label">上传照片 / 报告</label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 hover:bg-slate-100">
              <Upload className="mb-2" />
              点击选择文件，正式版会保存到会员健康记录
              <input type="file" className="hidden" multiple />
            </label>
          </div>
          <button className="btn-primary w-full" type="submit">
            产生保养建议
          </button>
          {submitted && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm leading-6 text-green-700">
              已建立本次体验记录。正式 AI 判读接上后，这里会自动产生产品推荐、回访提醒与客服通知。
            </div>
          )}
        </form>

        <aside className="space-y-4">
          <div className="card">
            <h2 className="text-xl font-black text-slate-950">目前建议方向</h2>
            <div className="mt-4 space-y-3">
              {recommendedPlans.map((plan) => (
                <div key={plan.title} className="rounded-2xl bg-slate-50 p-4">
                  <h3 className="font-bold text-slate-950">{plan.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{plan.reason}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-teal-700">{plan.action}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Link href="/portal/shop" className="rounded-2xl border border-amber-100 bg-amber-50 p-5 font-bold text-amber-700 hover:bg-amber-100">
              <ShoppingBag className="mb-2" />
              查看商城推荐商品
            </Link>
            <Link href="/stores/locator" className="rounded-2xl border border-blue-100 bg-blue-50 p-5 font-bold text-blue-700 hover:bg-blue-100">
              <MapPin className="mb-2" />
              查找最近体验网点
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
