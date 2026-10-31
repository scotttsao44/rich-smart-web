'use client';

import Link from 'next/link';
import { useAuth } from '@/app/providers';
import { useEffect, useState } from 'react';
import {
  ShoppingBag,
  User,
  Coins,
  Users,
  ArrowRight,
  Star,
  TrendingUp,
  Wallet,
  ClipboardList,
  Copy,
  Link as LinkIcon,
  MessageCircle,
  HeartPulse,
} from 'lucide-react';

const levelNames = ['养生会员', '健康分享家', '养生顾问', '健康合伙人'];
const levelColors = [
  'bg-gray-100 text-gray-800',
  'bg-green-100 text-green-800',
  'bg-blue-100 text-blue-800',
  'bg-amber-100 text-amber-800',
];

export default function PortalDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ orders: 0, commissions: 0, team: 0 });
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  const referralCode = user?.referralCode || (user?.id ? `RS${user.id}` : '');
  const referralLink = origin && referralCode ? `${origin}/join?ref=${encodeURIComponent(referralCode)}` : '';

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    async function fetchStats() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const [ordersRes, commissionsRes, teamRes] = await Promise.all([
          fetch(`/api/orders?userId=${user.id}`),
          fetch(`/api/commissions?userId=${user.id}`),
          fetch(`/api/team?userId=${user.id}`),
        ]);

        const ordersData = ordersRes.ok ? await ordersRes.json() : { orders: [] };
        const commissionsData = commissionsRes.ok
          ? await commissionsRes.json()
          : { commissions: [] };
        const teamData = teamRes.ok ? await teamRes.json() : { downlines: [] };

        const totalCommission =
          commissionsData.commissions?.reduce(
            (sum: number, c: any) => sum + parseFloat(c.amount || 0),
            0
          ) || 0;

        setStats({
          orders: ordersData.orders?.length || 0,
          commissions: totalCommission,
          team: teamData.downlines?.length || 0,
        });
      } catch (err) {
        console.error('加载统计失败:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [user?.id]);

  const copyReferralLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">请先登录</h2>
        <p className="text-gray-500 mb-6">您需要登录才能查看会员中心</p>
        <Link href="/login" className="btn-primary">
          前往登录
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Welcome Header */}
      <div className="card mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              歡迎回来，{user.name || '会员'}！
            </h1>
            <p className="text-gray-500">这里是您的专屬会员中心</p>
          </div>
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium w-fit ${
              levelColors[user.agentLevel] || levelColors[0]
            }`}
          >
            <Star size={14} className="mr-1" />
            {levelNames[user.agentLevel] || levelNames[0]}
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-amber-100 rounded-lg">
              <TrendingUp size={20} className="text-amber-600" />
            </div>
            <span className="text-sm text-gray-500">订单数</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {loading ? '...' : stats.orders}
          </p>
        </div>
        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Wallet size={20} className="text-green-600" />
            </div>
            <span className="text-sm text-gray-500">累积佣金</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {loading ? '...' : `NT$${stats.commissions.toFixed(2)}`}
          </p>
        </div>
        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users size={20} className="text-blue-600" />
            </div>
            <span className="text-sm text-gray-500">团队人数</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {loading ? '...' : stats.team}
          </p>
        </div>
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="card border-amber-100 bg-gradient-to-br from-amber-50 to-white">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700">
                <LinkIcon size={14} />
                我的推荐码：{referralCode}
              </div>
              <h2 className="text-2xl font-black text-slate-950">复制推荐链接，先让朋友完成 LINE / 微信绑定</h2>
              <p className="mt-3 max-w-2xl leading-7 text-slate-600">
                朋友点击这个链接后，会先加入商家 LINE 或微信公众号。授权登录完成时，系统会把您的推荐码写入他的会员资料，后续购买、申请代理与佣金才会正确计算。
              </p>
            </div>
            <button
              type="button"
              onClick={copyReferralLink}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 font-bold text-white hover:bg-slate-800"
            >
              <Copy size={18} />
              {copied ? '已复制' : '复制推荐链接'}
            </button>
          </div>
          <div className="mt-5 break-all rounded-2xl border border-amber-100 bg-white px-4 py-3 text-sm font-medium text-slate-700">
            {referralLink || '推荐链接产生中...'}
          </div>
        </div>

        <div className="card bg-slate-950 text-white">
          <MessageCircle className="mb-3 text-teal-300" />
          <h2 className="text-xl font-black">歡迎语重点</h2>
          <p className="mt-3 text-sm leading-6 text-slate-200">
            歡迎加入糙米。您已完成推荐码绑定，可以領取健康体验、查看推荐制度，也能申请成为代理，把您的专屬推荐链接分享给朋友。
          </p>
        </div>
      </div>

      <div className="card mb-8 border-teal-100 bg-teal-50">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-teal-100 p-3 text-teal-700">
              <HeartPulse size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-950">智能 CRM：从健康数据开始推荐</h2>
              <p className="mt-2 max-w-3xl leading-7 text-slate-600">
                下一步会把体验健康数据、商城产品与最近网点串起来：上传数据后，系统提示「1+1 &gt; 3」保养方案，推荐适合产品或引导到附近体验店。
              </p>
            </div>
          </div>
          <Link href="/portal/health" className="btn-outline shrink-0">
            上传健康数据
          </Link>
        </div>
      </div>

      {/* Quick Links */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">快捷入口</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Link
          href="/portal/shop"
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-100 rounded-lg group-hover:bg-amber-200 transition-colors">
                <ShoppingBag size={24} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">商城</h3>
                <p className="text-sm text-gray-500">浏览商品</p>
              </div>
            </div>
            <ArrowRight
              size={18}
              className="text-gray-300 group-hover:text-amber-500 transition-colors"
            />
          </div>
        </Link>

        <Link
          href="/portal/health"
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-teal-100 rounded-lg group-hover:bg-teal-200 transition-colors">
                <HeartPulse size={24} className="text-teal-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">健康数据</h3>
                <p className="text-sm text-gray-500">产生推荐</p>
              </div>
            </div>
            <ArrowRight
              size={18}
              className="text-gray-300 group-hover:text-teal-500 transition-colors"
            />
          </div>
        </Link>

        <Link
          href="/portal/orders"
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-orange-100 rounded-lg group-hover:bg-orange-200 transition-colors">
                <ClipboardList size={24} className="text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">我的订单</h3>
                <p className="text-sm text-gray-500">查看订单状态</p>
              </div>
            </div>
            <ArrowRight
              size={18}
              className="text-gray-300 group-hover:text-orange-500 transition-colors"
            />
          </div>
        </Link>

        <Link
          href="/portal/profile"
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                <User size={24} className="text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">个人资料</h3>
                <p className="text-sm text-gray-500">编辑信息</p>
              </div>
            </div>
            <ArrowRight
              size={18}
              className="text-gray-300 group-hover:text-blue-500 transition-colors"
            />
          </div>
        </Link>

        <Link
          href="/portal/commissions"
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg group-hover:bg-green-200 transition-colors">
                <Coins size={24} className="text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">佣金</h3>
                <p className="text-sm text-gray-500">查看明细</p>
              </div>
            </div>
            <ArrowRight
              size={18}
              className="text-gray-300 group-hover:text-green-500 transition-colors"
            />
          </div>
        </Link>

        <Link
          href="/portal/team"
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                <Users size={24} className="text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">团队</h3>
                <p className="text-sm text-gray-500">管理下线</p>
              </div>
            </div>
            <ArrowRight
              size={18}
              className="text-gray-300 group-hover:text-purple-500 transition-colors"
            />
          </div>
        </Link>
      </div>
    </div>
  );
}
