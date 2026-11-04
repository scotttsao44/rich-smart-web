'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Database,
  LayoutDashboard,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Store,
  UserRoundCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import ChinaLogoutButton from '@/components/ChinaLogoutButton';
import StoreApplicationReview from '@/components/StoreApplicationReview';
import WechatPayReconciliationCenter, { ReconcileOrderItem, ReconciliationSummary } from '@/components/WechatPayReconciliationCenter';

type Period = 'today' | 'week' | 'month' | 'all';

type Member = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  referralCode?: string;
  referrerCode?: string;
  wechatBound?: boolean;
  platformAdmin?: boolean;
  createdAt?: string;
};

type BrandPerformance = {
  brandId: number;
  brandName: string;
  companyName?: string;
  status: string;
  productCount?: number;
  memberCount?: number;
  orderCount?: number;
  pendingShipmentCount?: number;
  salesAmount?: number;
};

type PlatformOverview = {
  viewer?: { id: number; name: string };
  summary: Record<string, number>;
  members: Member[];
  brands: Array<Record<string, any>>;
  products: Array<Record<string, any>>;
  stores: Array<Record<string, any>>;
  orders: Array<Record<string, any>>;
  allOrders?: Array<Record<string, any>>;
  reconciliation?: ReconciliationSummary;
  finance?: { withdrawals?: Array<Record<string, any>> };
  brandPerformance?: BrandPerformance[];
};

type PaymentSettings = {
  platformFeeRate: number;
  paymentChannelFeeRate: number;
  riskReserveRate: number;
  updatedAt: string | null;
};

const periods: Array<{ value: Period; label: string }> = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '全部' },
];

const statusText: Record<string, string> = {
  approved: '已通过',
  pending: '待审核',
  rejected: '已退回',
  active: '运营中',
  paid: '已付款',
  pending_payment: '待付款',
  shipped: '已发货',
  delivered: '已送达',
  completed: '已完成',
  refunded: '已退款',
};

function money(value: unknown) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function recent(createdAt?: string) {
  if (!createdAt) return false;
  const time = new Date(createdAt).getTime();
  return Number.isFinite(time) && Date.now() - time <= 7 * 24 * 60 * 60 * 1000;
}

function shortDate(value?: string) {
  if (!value) return '时间未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未记录';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function ChinaOpsDashboardPage() {
  const [period, setPeriod] = useState<Period>('today');
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewResponse, settingsResponse] = await Promise.all([
        fetch(`/api/cn/platform-overview?period=${period}`, { cache: 'no-store' }),
        fetch('/api/cn/payment-settings', { cache: 'no-store' }),
      ]);
      if ([overviewResponse.status, settingsResponse.status].some((status) => status === 401 || status === 403)) {
        window.location.replace('/cn/shop');
        return;
      }
      const overviewData = await overviewResponse.json().catch(() => ({}));
      const settingsData = await settingsResponse.json().catch(() => ({}));
      if (!overviewResponse.ok) throw new Error(overviewData.error || '平台数据读取失败');
      if (!settingsResponse.ok) throw new Error(settingsData.error || '费率设置读取失败');
      setOverview(overviewData);
      setPaymentSettings(settingsData.settings || null);
      setLastUpdated(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '平台数据读取失败');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const summary = overview?.summary || {};
  const members = useMemo(() => overview?.members || [], [overview?.members]);
  const brands = overview?.brands || [];
  const products = overview?.products || [];
  const orders = overview?.orders || [];
  const brandPerformance = useMemo(() => overview?.brandPerformance || [], [overview?.brandPerformance]);
  const withdrawals = overview?.finance?.withdrawals || [];

  const memberSummary = useMemo(() => ({
    total: members.length,
    newThisWeek: members.filter((member) => recent(member.createdAt)).length,
    wechatBound: members.filter((member) => member.wechatBound).length,
    withoutReferrer: members.filter((member) => !member.referrerCode).length,
    platformAdmins: members.filter((member) => member.platformAdmin).length
      + (overview?.viewer && !members.some((member) => member.id === overview.viewer?.id) ? 1 : 0),
  }), [members, overview?.viewer]);

  const newestMembers = useMemo(() => [...members]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 5), [members]);

  const rankedBrands = useMemo(() => [...brandPerformance]
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return Number(b.salesAmount || 0) - Number(a.salesAmount || 0);
    })
    .slice(0, 6), [brandPerformance]);

  const pendingWithdrawals = withdrawals.filter((row) => ['requested', 'reviewing', 'processing'].includes(String(row.status))).length;
  const pendingBankTransfers = orders.filter((order) => order.paymentMethod === 'bank_transfer' && order.paymentStatus === 'pending').length;
  const pendingShipments = brandPerformance.reduce((sum, brand) => sum + Number(brand.pendingShipmentCount || 0), 0);
  const pendingBrands = Number(summary.pendingBrands || 0);
  const pendingProducts = Number(summary.pendingProducts || 0);
  const pendingStores = Number(summary.pendingStores || 0);
  const pendingTotal = pendingBrands + pendingProducts + pendingStores + pendingWithdrawals + pendingBankTransfers + pendingShipments;
  const paidOrders = Number(summary.paidOrders || 0);
  const approvedBrands = brands.filter((brand) => brand.status === 'approved').length;
  const approvedProducts = products.filter((product) => product.status === 'approved').length;

  const tasks = [
    { title: '品牌申请', detail: '核对主体、文件与品牌资料', count: pendingBrands, href: '/cn/ops/brands#brand-review', icon: Building2, tone: 'amber' },
    { title: '商品审核', detail: '检查图片、售价、库存与资质', count: pendingProducts, href: '/cn/ops/brands#product-review', icon: PackageCheck, tone: 'amber' },
    { title: '门店申请', detail: '审核场地并安排设备', count: pendingStores, href: '#store-review', icon: Store, tone: 'amber' },
    { title: '提现申请', detail: '核对收款资料与付款状态', count: pendingWithdrawals, href: '/cn/ops/finance', icon: WalletCards, tone: 'red' },
    { title: '银行款项', detail: '确认线下转账是否到账', count: pendingBankTransfers, href: '/cn/ops/finance', icon: CircleDollarSign, tone: 'red' },
    { title: '品牌待发货', detail: '追踪已付款但尚未发货订单', count: pendingShipments, href: '/cn/ops/data?view=orders', icon: ShoppingCart, tone: 'teal' },
  ];

  const functions = [
    { title: '会员与权限', detail: `${members.length} 位会员 · ${memberSummary.platformAdmins} 位平台主管`, href: '/cn/ops/data?view=members', icon: Users, state: '查看会员' },
    { title: '品牌与商品', detail: `${approvedBrands} 个品牌 · ${approvedProducts} 件已通过商品`, href: '/cn/ops/brands', icon: Building2, state: `${pendingBrands + pendingProducts} 项待办` },
    { title: '订单与交易', detail: `${orders.length} 笔订单 · ${paidOrders} 笔已付款`, href: '/cn/ops/data?view=orders', icon: ShoppingCart, state: '查看订单' },
    { title: '财务与提现', detail: `${pendingWithdrawals} 笔提现 · ${pendingBankTransfers} 笔转账待确认`, href: '/cn/ops/finance', icon: BadgeDollarSign, state: '进入财务' },
    { title: '门店与设备', detail: `${Number(summary.stores || 0)} 家运营中 · ${pendingStores} 家处理中`, href: '#store-review', icon: Store, state: '处理申请' },
    { title: '费率与分润', detail: paymentSettings?.updatedAt ? `平台服务费 ${paymentSettings.platformFeeRate}%` : '支付通道费与准备金尚未确认', href: '/cn/ops/finance', icon: Settings2, state: paymentSettings?.updatedAt ? '已设置' : '待设置' },
    { title: '全量数据', detail: '按会员、品牌、商品、门店、订单与资金分类', href: '/cn/ops/data', icon: Database, state: '打开数据' },
    { title: '需要推送的人', detail: '店主通知、服务号绑定、送达结果与 48 小时窗口', href: '/cn/ops/push-people', icon: Users, state: '查看名单' },
    { title: '商城预览', detail: '查看消费者实际看到的商品与推荐', href: '/cn/shop', icon: ShoppingBag, state: '查看商城' },
  ];

  return (
    <main className="min-h-screen bg-[#f5f6f2] px-4 py-6 text-stone-950">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-stone-300 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-teal-800"><LayoutDashboard className="h-4 w-4" />糙米平台</div>
              <h1 className="mt-2 text-3xl font-black">平台运营台</h1>
              <p className="mt-1 text-sm font-semibold text-stone-500">{overview?.viewer?.name || '平台主管'} · {pendingTotal ? `${pendingTotal} 项需要处理` : '目前没有紧急待办'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold">
                {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <button type="button" onClick={() => void load()} aria-label="刷新平台数据" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
              <Link href="/cn/shop" className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-700 bg-white px-4 text-sm font-black text-teal-800"><ShoppingBag className="h-4 w-4" />商城</Link>
              <ChinaLogoutButton />
            </div>
          </div>
          <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 text-sm font-black">
            <a href="#wechat-reconciliation" className="whitespace-nowrap rounded-md bg-emerald-700 px-4 py-2 text-white">💰 微信支付对账中心</a>
            <a href="#todo" className="whitespace-nowrap rounded-md bg-stone-950 px-4 py-2 text-white">待办中心</a>
            <a href="#members" className="whitespace-nowrap rounded-md border border-stone-300 bg-white px-4 py-2">会员</a>
            <a href="#brands" className="whitespace-nowrap rounded-md border border-stone-300 bg-white px-4 py-2">品牌</a>
            <a href="#functions" className="whitespace-nowrap rounded-md border border-stone-300 bg-white px-4 py-2">功能入口</a>
          </nav>
        </header>

        {error ? <div className="mt-5 flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-800"><AlertTriangle className="h-5 w-5" />{error}</div> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: '待处理', value: pendingTotal, note: '需要平台主管处理', icon: Clock3, color: 'text-red-700', href: '#todo' },
            { label: '会员总数', value: memberSummary.total, note: `近 7 天新增 ${memberSummary.newThisWeek}`, icon: Users, color: 'text-teal-800', href: '/cn/ops/data?view=members' },
            { label: '运营品牌', value: approvedBrands, note: `${pendingBrands} 个待审核`, icon: Building2, color: 'text-amber-700', href: '#brands' },
            { label: '成交金额', value: money(summary.gmv), note: `${paidOrders} 笔已付款订单`, icon: BadgeDollarSign, color: 'text-emerald-700', href: '/cn/ops/data?view=orders' },
          ].map(({ label, value, note, icon: Icon, color, href }) => (
            <Link key={label} href={href} className="rounded-md border border-stone-200 bg-white p-4 hover:border-teal-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
              <div className="flex items-center justify-between"><span className="text-sm font-bold text-stone-500">{label}</span><Icon className={`h-5 w-5 ${color}`} /></div>
              <div className="mt-2 text-3xl font-black">{value}</div>
              <div className="mt-1 text-xs font-bold text-stone-500">{note}</div>
            </Link>
          ))}
        </section>

        <div className="mt-7">
          <WechatPayReconciliationCenter
            orders={((overview?.allOrders || overview?.orders || []) as unknown) as ReconcileOrderItem[]}
            summary={overview?.reconciliation || null}
            onRefresh={load}
          />
        </div>

        <section id="todo" className="mt-7 scroll-mt-4 border-t border-stone-300 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-xl font-black">待办中心</h2><p className="mt-1 text-sm font-semibold text-stone-500">需由平台主管处理</p></div>
            <span className={`rounded-full px-3 py-1 text-xs font-black ${pendingTotal ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{pendingTotal ? `${pendingTotal} 项未完成` : '全部处理完成'}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((task) => {
              const Icon = task.icon;
              return (
                <Link key={task.title} href={task.href} className="group flex min-h-28 items-center gap-4 rounded-md border border-stone-200 bg-white p-4 transition hover:border-teal-600 hover:bg-teal-50">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${task.count ? (task.tone === 'red' ? 'bg-red-50 text-red-700' : task.tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-700') : 'bg-stone-100 text-stone-500'}`}><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h3 className="font-black">{task.title}</h3><span className="text-2xl font-black">{task.count}</span></div><p className="mt-1 text-sm font-semibold text-stone-500">{task.count ? task.detail : '目前无需处理'}</p></div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-stone-400 transition group-hover:translate-x-1 group-hover:text-teal-700" />
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-7 grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
          <div id="members" className="min-w-0 scroll-mt-4 border-t border-stone-300 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-black">会员状况</h2><p className="mt-1 text-sm font-semibold text-stone-500">登录、微信绑定、推荐关系与权限</p></div><Link href="/cn/ops/data?view=members" className="inline-flex shrink-0 items-center gap-1 text-sm font-black text-teal-800">全部会员<ArrowRight className="h-4 w-4" /></Link></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['总会员', memberSummary.total],
                ['微信已绑定', memberSummary.wechatBound],
                ['未绑定推荐人', memberSummary.withoutReferrer],
                ['平台主管', memberSummary.platformAdmins],
              ].map(([label, value]) => <div key={String(label)} className="rounded-md border border-stone-200 bg-white p-3"><div className="text-xs font-bold text-stone-500">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></div>)}
            </div>
            <div className="mt-3 divide-y divide-stone-100 rounded-md border border-stone-200 bg-white">
              {newestMembers.length ? newestMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0"><div className="truncate font-black">{member.name || `会员 ${member.id}`}</div><div className="mt-1 truncate text-xs font-semibold text-stone-500">{member.phone || member.email || `ID ${member.id}`} · {shortDate(member.createdAt)}</div></div>
                  <div className="flex shrink-0 gap-1">{member.wechatBound ? <span title="微信已绑定" className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><Smartphone className="h-4 w-4" /></span> : null}{member.platformAdmin ? <span className="rounded-md bg-stone-950 px-2 py-1 text-xs font-black text-white">平台主管</span> : null}</div>
                </div>
              )) : <div className="px-4 py-8 text-center text-sm font-bold text-stone-500">暂无会员资料</div>}
            </div>
          </div>

          <div id="brands" className="min-w-0 scroll-mt-4 border-t border-stone-300 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-black">品牌状况</h2><p className="mt-1 text-sm font-semibold text-stone-500">审核、商品、会员、订单与销售表现</p></div><Link href="/cn/ops/brands" className="inline-flex shrink-0 items-center gap-1 text-sm font-black text-teal-800">品牌管理<ArrowRight className="h-4 w-4" /></Link></div>
            <div className="mt-4 overflow-hidden rounded-md border border-stone-200 bg-white">
              <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-stone-100 bg-stone-50 px-4 py-3 text-xs font-black text-stone-500 sm:grid"><span>品牌</span><span>会员 / 订单</span><span>销售</span></div>
              <div className="divide-y divide-stone-100">
                {rankedBrands.length ? rankedBrands.map((brand) => (
                  <Link key={brand.brandId} href={brand.status === 'pending' ? '/cn/ops/brands#brand-review' : '/cn/ops/data?view=brands'} className="grid grid-cols-1 items-center gap-3 px-4 py-3 transition hover:bg-teal-50 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <div className="min-w-0"><div className="truncate font-black">{brand.brandName || '未命名品牌'}</div><div className="mt-1 truncate text-xs font-semibold text-stone-500">{brand.companyName || '未填写公司'} · {statusText[brand.status] || brand.status}</div></div>
                    <div className="min-w-0 break-words text-sm font-bold text-stone-600 sm:text-right"><span className="sm:hidden">会员 / 订单：</span>{brand.memberCount || 0} / {brand.orderCount || 0}</div>
                    <div className="min-w-0 break-all font-black text-teal-800 sm:min-w-24 sm:text-right"><span className="sm:hidden">销售：</span>{money(brand.salesAmount)}</div>
                  </Link>
                )) : <div className="px-4 py-8 text-center text-sm font-bold text-stone-500">暂无品牌资料</div>}
              </div>
            </div>
          </div>
        </section>

        <section id="functions" className="mt-7 scroll-mt-4 border-t border-stone-300 pt-5">
          <div><h2 className="text-xl font-black">功能入口</h2><p className="mt-1 text-sm font-semibold text-stone-500">会员、品牌、交易、门店与系统设置</p></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {functions.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.title} href={item.href} className="group rounded-md border border-stone-200 bg-white p-4 transition hover:border-teal-600 hover:bg-teal-50">
                  <div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-stone-950 text-white"><Icon className="h-5 w-5" /></span><ArrowRight className="h-4 w-4 text-stone-400 transition group-hover:translate-x-1 group-hover:text-teal-700" /></div>
                  <h3 className="mt-4 font-black">{item.title}</h3><p className="mt-1 min-h-10 text-sm font-semibold text-stone-500">{item.detail}</p><div className="mt-3 text-xs font-black text-teal-800">{item.state}</div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-7 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div className="min-w-0 border-t border-stone-300 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-black">最近订单</h2><p className="mt-1 text-sm font-semibold text-stone-500">快速确认付款与履约状态</p></div><Link href="/cn/ops/data?view=orders" className="shrink-0 text-sm font-black text-teal-800">全部订单</Link></div>
            <div className="mt-4 divide-y divide-stone-100 rounded-md border border-stone-200 bg-white">
              {orders.slice(0, 6).map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="min-w-0 flex-1"><div className="break-all font-black">{order.orderNo}</div><div className="mt-1 break-words text-xs font-semibold text-stone-500">{order.shippingName || `会员 ${order.userId}`} · {(order.items || []).map((item: any) => item.productName).join('、') || '未记录商品'}</div></div><div className="min-w-0 max-w-full text-right"><div className="break-all font-black text-teal-800">{money(order.totalAmount)}</div><div className="mt-1 text-xs font-bold text-stone-500">{statusText[order.paymentStatus] || statusText[order.status] || order.status}</div></div></div>)}
              {!orders.length ? <div className="px-4 py-8 text-center text-sm font-bold text-stone-500">所选期间暂无订单</div> : null}
            </div>
          </div>
          <div className="border-t border-stone-300 pt-5">
            <h2 className="text-xl font-black">系统状态</h2><p className="mt-1 text-sm font-semibold text-stone-500">目前管理功能与资料读取状态</p>
            <div className="mt-4 divide-y divide-stone-100 rounded-md border border-stone-200 bg-white">
              <div className="flex items-center justify-between px-4 py-4"><span className="flex items-center gap-2 font-bold"><Activity className="h-4 w-4 text-emerald-700" />资料服务</span><span className="text-xs font-black text-emerald-700">{error ? '需要检查' : '正常'}</span></div>
              <div className="flex items-center justify-between px-4 py-4"><span className="flex items-center gap-2 font-bold"><UserRoundCheck className="h-4 w-4 text-teal-700" />权限保护</span><span className="text-xs font-black text-teal-800">平台主管限定</span></div>
              <div className="flex items-center justify-between px-4 py-4"><span className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4 text-amber-700" />费率配置</span><span className={`text-xs font-black ${paymentSettings?.updatedAt ? 'text-emerald-700' : 'text-amber-700'}`}>{paymentSettings?.updatedAt ? '已设置' : '待确认'}</span></div>
              <div className="flex items-center justify-between px-4 py-4"><span className="text-sm font-bold text-stone-500">更新时间</span><span className="text-xs font-black text-stone-700">{lastUpdated ? lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '读取中'}</span></div>
            </div>
          </div>
        </section>

        <div id="store-applications" className="scroll-mt-4"><StoreApplicationReview /></div>
      </div>
    </main>
  );
}
