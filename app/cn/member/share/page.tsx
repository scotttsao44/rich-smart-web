'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  QrCode,
  RefreshCw,
  Share2,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '@/app/providers';
import ReferralQrCode from '@/components/ReferralQrCode';
import WechatShareButton from '@/components/WechatShareButton';

interface TeamMemberRow {
  id: number | string;
  name: string;
  referralCode?: string;
  referrerCode?: string;
  parentName?: string;
  relation: string;
  level: number;
  stage: string;
  joinedAt: string;
  orders: number;
  amount: string;
  reward: string;
  rewardStatus: string;
}

interface WorkspaceData {
  profile?: {
    id?: number;
    name?: string;
    referralSharingEnabled?: boolean;
  };
  referralCode?: string;
  referralPath?: string;
  referralRelation?: {
    referredByMemberId?: number;
    referrerName?: string;
    referrerCode?: string;
    boundAt?: string;
  } | null;
  referrals?: TeamMemberRow[];
  metrics?: Array<{ label: string; value: string }>;
  referralEngagement?: {
    metrics?: {
      referralVisits?: number;
      referralRegistrations?: number;
      referralAppointments?: number;
      referralOrders?: number;
    };
  };
}

export default function MemberShareWorkbenchPage() {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedType, setCopiedType] = useState<'main' | 'exp' | 'code' | null>(null);
  const [origin, setOrigin] = useState('https://caomi.47-116-127-122.sslip.io');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cn/workspaces/member?range=30d', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadData();
    } else {
      setLoading(false);
    }
  }, [user, loadData]);

  if (!user) {
    return (
      <main className="min-h-screen bg-[#f6f4ee] px-4 py-16">
        <div className="mx-auto max-w-lg rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-xs">
          <QrCode className="mx-auto mb-3 h-12 w-12 text-emerald-700" />
          <h1 className="text-xl font-bold text-stone-900">请先登录会员账号</h1>
          <p className="mt-2 text-sm text-stone-600">
            登录后即可进入推广工作台，获取专属分享海报、二维码与多级团队收益明细。
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/cn/login?next=%2Fcn%2Fmember%2Fshare"
              className="rounded-xl bg-[#07C160] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#06ad56]"
            >
              微信 / 手机一键登录
            </Link>
            <Link
              href="/cn/experience"
              className="rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-bold text-stone-800 hover:bg-stone-50"
            >
              极速体验通道
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const myCode = workspace?.referralCode || user.referralCode || `RS-CN-${user.id}`;
  const mainShareUrl = `${origin}/cn?ref=${encodeURIComponent(myCode)}`;
  const expShareUrl = `${origin}/cn/experience?ref=${encodeURIComponent(myCode)}`;
  const referrals = workspace?.referrals || [];
  const level1List = referrals.filter((r) => Number(r.level) === 1);
  const level2List = referrals.filter((r) => Number(r.level) === 2);

  const handleCopy = async (text: string, type: 'main' | 'exp' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2200);
    } catch {
      // ignore
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#eaf6f0] via-[#f6f4ee] to-white px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/cn/member"
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-bold text-stone-800 hover:bg-stone-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回会员中心
            </Link>
            <Link
              href="/cn/experience"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100"
            >
              微信尊享会员卡
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-bold text-stone-800 hover:bg-stone-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新推广数据
            </button>
            <Link
              href="/cn/promoter"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-900 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              推广员进阶工作台 (/cn/promoter)
            </Link>
          </div>
        </div>

        {/* Hero Banner */}
        <div className="rounded-3xl bg-gradient-to-br from-[#07c160] via-[#06ad56] to-[#048848] p-6 text-white shadow-xl shadow-emerald-950/10">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
                <Sparkles className="h-3.5 w-3.5" />
                糙米健康 · 会员推广工作台与分享海报中心
              </span>
              <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
                {user.name} 的专属裂变推广中心
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-emerald-50/90">
                一键分享专属主入口链接或微信海报，好友访问注册即自动锁定归属您的直接推荐团队（支持 A → B → C 多级团队追踪）
              </p>
            </div>

            <div className="rounded-2xl border border-white/20 bg-black/15 p-4 backdrop-blur-xs">
              <div className="text-xs text-emerald-100">我的专属推荐码</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-xl font-black tracking-wider">{myCode}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(myCode, 'code')}
                  className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold hover:bg-white/30"
                >
                  {copiedType === 'code' ? '✓ 已复制' : '复制'}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-100">
                <UserCheck className="h-3.5 w-3.5" />
                我的直接推荐人：
                <strong className="text-white">
                  {workspace?.referralRelation?.referrerName || 'Scoot（平台主管）'}
                </strong>
                {workspace?.referralRelation?.referrerCode && (
                  <span className="font-mono text-[11px] opacity-90">
                    ({workspace.referralRelation.referrerCode})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs">
            <p className="text-xs font-semibold text-stone-500">一级直接推荐会员</p>
            <p className="mt-1 text-2xl font-black text-emerald-900">{level1List.length} 人</p>
            <p className="mt-0.5 text-[11px] text-stone-400">通过您的链接直接注册</p>
          </div>
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs">
            <p className="text-xs font-semibold text-stone-500">二级裂变推荐会员</p>
            <p className="mt-1 text-2xl font-black text-teal-800">{level2List.length} 人</p>
            <p className="mt-0.5 text-[11px] text-stone-400">由您的一级会员继续分享注册</p>
          </div>
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs">
            <p className="text-xs font-semibold text-stone-500">近30天推广访问量</p>
            <p className="mt-1 text-2xl font-black text-stone-900">
              {workspace?.referralEngagement?.metrics?.referralVisits ?? 0} 次
            </p>
            <p className="mt-0.5 text-[11px] text-stone-400">包含扫码与链接点击</p>
          </div>
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs">
            <p className="text-xs font-semibold text-stone-500">可提现推广收益</p>
            <p className="mt-1 text-2xl font-black text-amber-700">
              {workspace?.metrics?.find((m) => m.label === '可提现收益')?.value || '¥0.00'}
            </p>
            <p className="mt-0.5 text-[11px] text-stone-400">订单确认后自动结算</p>
          </div>
        </div>

        {/* Share Links & QR Poster Card */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl border border-stone-200/90 bg-white p-6 shadow-xs space-y-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                SHARE LINKS · 专属推广链接
              </span>
              <h2 className="mt-1 text-lg font-bold text-stone-900">
                一键复制分享链接（自动覆盖并锁定您的推荐归属）
              </h2>
              <p className="mt-1 text-xs text-stone-600">
                好友点击以下任意一条链接进入并注册，系统将无条件以您的推广码 <code className="font-mono font-bold text-emerald-800">{myCode}</code> 作为直接推荐人。
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-emerald-900/15 bg-emerald-50/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-900">
                    方式一：糙米健康全站主入口推广链接（推荐发朋友圈/微信群）
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    主力推荐
                  </span>
                </div>
                <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <code className="truncate rounded-xl bg-white px-3 py-2 text-xs font-mono text-stone-800 border border-emerald-900/10 select-all">
                    {mainShareUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(mainShareUrl, 'main')}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#07C160] px-4 py-2 text-xs font-bold text-white hover:bg-[#06ad56]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedType === 'main' ? '✓ 已复制主入口链接' : '复制主入口链接'}
                  </button>
                  <WechatShareButton referralCode={myCode} nickname={user.name} />
                </div>
              </div>

              <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-stone-800">
                    方式二：微信极速领卡直通链接（10秒免验证码激活会员）
                  </span>
                  <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-[10px] font-bold text-stone-700">
                    高转化直达
                  </span>
                </div>
                <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <code className="truncate rounded-xl bg-white px-3 py-2 text-xs font-mono text-stone-800 border border-stone-200 select-all">
                    {expShareUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(expShareUrl, 'exp')}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-xs font-bold text-white hover:bg-stone-800"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    {copiedType === 'exp' ? '✓ 已复制极速领卡链接' : '复制极速领卡链接'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* QR Poster */}
          <div className="rounded-3xl border border-emerald-900/15 bg-gradient-to-b from-emerald-50/70 to-white p-6 shadow-xs flex flex-col items-center justify-between text-center">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900">
                <QrCode className="h-3.5 w-3.5" />
                专属微信推广二维码海报
              </span>
              <h3 className="mt-2 text-base font-bold text-stone-900">
                {user.name} 邀您体验糙米健康
              </h3>
              <p className="mt-0.5 text-xs text-stone-500">
                微信扫一扫 · 自动绑定推荐码 {myCode}
              </p>
            </div>

            <div className="my-4 w-48 rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-sm">
              <ReferralQrCode value={expShareUrl} />
            </div>

            <p className="text-[11px] text-stone-500">
              可截图保存上方二维码海报发送给微信好友或门店客户
            </p>
          </div>
        </div>

        {/* Multi-level Referral Team List */}
        <div className="rounded-3xl border border-stone-200/90 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                TEAM HIERARCHY · 多级推荐团队明细
              </span>
              <h2 className="mt-0.5 text-lg font-bold text-stone-900 flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-700" />
                我的推荐团队成员（共 {referrals.length} 人）
              </h2>
            </div>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-stone-500">正在同步团队成员数据...</div>
          ) : referrals.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center">
              <p className="text-sm font-bold text-stone-700">暂无下级推荐会员记录</p>
              <p className="mt-1 text-xs text-stone-500">
                复制上方推广链接或二维码分享给好友，好友完成注册后将实时显示在此列表。
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs font-bold text-stone-500">
                    <th className="pb-3 pr-4">会员昵称</th>
                    <th className="pb-3 pr-4">专属推广码</th>
                    <th className="pb-3 pr-4">层级关系</th>
                    <th className="pb-3 pr-4">状态</th>
                    <th className="pb-3 pr-4">注册日期</th>
                    <th className="pb-3 pr-4">订单数</th>
                    <th className="pb-3">贡献收益</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {referrals.map((item) => (
                    <tr key={item.id} className="hover:bg-stone-50/70">
                      <td className="py-3 pr-4 font-bold text-stone-900">{item.name}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-stone-600">
                        {item.referralCode || '-'}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            Number(item.level) === 1
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-teal-100 text-teal-800'
                          }`}
                        >
                          {item.relation}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {item.stage}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-xs text-stone-500">{item.joinedAt}</td>
                      <td className="py-3 pr-4 font-semibold text-stone-800">{item.orders}</td>
                      <td className="py-3 font-bold text-amber-700">{item.reward}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
