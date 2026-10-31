'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  FlaskConical,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

export interface ReconcileOrderItem {
  id: number;
  orderNo: string;
  userId?: number;
  buyerName?: string | null;
  buyerPhone?: string | null;
  shippingName?: string | null;
  shippingPhone?: string | null;
  totalAmount: string | number;
  currency?: string | null;
  status: string;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  paymentMode?: string | null;
  testMode?: boolean;
  providerTransactionId?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  merchantId?: string | null;
  settlementBank?: string | null;
  settlementTarget?: string | null;
  items?: Array<{
    id?: number;
    productName?: string | null;
    quantity?: number | null;
    unitPrice?: string | number;
  }>;
}

export interface ReconciliationSummary {
  merchantId: string;
  merchantName: string;
  settlementBank: string;
  settlementTarget: string;
  livePaidTotalYuan: number;
  livePaidCount: number;
  pendingCount: number;
  pendingTotalYuan: number;
  testPaidCount: number;
  totalOrdersCount: number;
}

interface Props {
  orders: ReconcileOrderItem[];
  summary?: ReconciliationSummary | null;
  onRefresh?: () => Promise<void> | void;
  onStatusChange?: (orderId: number, newStatus: string) => Promise<void> | void;
  statusOptions?: Array<{ value: string; label: string }>;
  compact?: boolean;
  isMemberView?: boolean;
}

type FilterTab = 'all' | 'live_paid' | 'pending' | 'test';

function formatMoney(value: unknown) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatShanghaiTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })} (UTC+8)`;
}

function isOrderTestMode(order: ReconcileOrderItem) {
  if (typeof order.testMode === 'boolean') return order.testMode;
  const txId = String(order.providerTransactionId || '');
  return (
    order.paymentMode === 'test' ||
    txId.startsWith('test_') ||
    txId.startsWith('wx_sim_')
  );
}

function isLiveWechatPaid(order: ReconcileOrderItem) {
  return (
    order.paymentStatus === 'paid' &&
    !isOrderTestMode(order) &&
    (order.paymentMethod === 'wechat_pay' || order.paymentMethod === 'wechat_merchant')
  );
}

export default function WechatPayReconciliationCenter({
  orders,
  summary,
  onRefresh,
  onStatusChange,
  statusOptions,
  compact = false,
  isMemberView = false,
}: Props) {
  const [filterText, setFilterText] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [liveQueryInput, setLiveQueryInput] = useState('');
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<{
    ok: boolean;
    title: string;
    detail: string;
    transactionId?: string;
    orderNo?: string;
    amountYuan?: string;
    paidAt?: string;
    tradeState?: string;
  } | null>(null);

  const computedSummary = useMemo<ReconciliationSummary>(() => {
    if (summary) return summary;
    const livePaid = orders.filter((o) => isLiveWechatPaid(o));
    const pending = orders.filter((o) => o.paymentStatus !== 'paid' && o.status !== 'cancelled' && o.status !== 'refunded');
    const testPaid = orders.filter((o) => o.paymentStatus === 'paid' && isOrderTestMode(o));
    return {
      merchantId: '1118445617',
      merchantName: '苏州糙米量子科技有限公司',
      settlementBank: '农业银行对公账户（尾号 8694）',
      settlementTarget: '商户号 1118445617（苏州糙米量子）→ 农业银行对公账户（尾号 8694）',
      livePaidTotalYuan: Number(
        livePaid.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0).toFixed(2)
      ),
      livePaidCount: livePaid.length,
      pendingCount: pending.length,
      pendingTotalYuan: Number(
        pending.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0).toFixed(2)
      ),
      testPaidCount: testPaid.length,
      totalOrdersCount: orders.length,
    };
  }, [orders, summary]);

  const filteredOrders = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return orders.filter((order) => {
      if (filterTab === 'live_paid' && !isLiveWechatPaid(order)) return false;
      if (filterTab === 'pending' && order.paymentStatus === 'paid') return false;
      if (filterTab === 'test' && !isOrderTestMode(order)) return false;

      if (!q) return true;
      const orderNo = String(order.orderNo || '').toLowerCase();
      const txId = String(order.providerTransactionId || '').toLowerCase();
      const buyer = String(order.buyerName || order.shippingName || '').toLowerCase();
      const phone = String(order.buyerPhone || order.shippingPhone || '').toLowerCase();
      const itemsText = (order.items || [])
        .map((item) => String(item.productName || ''))
        .join(' ')
        .toLowerCase();
      return (
        orderNo.includes(q) ||
        txId.includes(q) ||
        buyer.includes(q) ||
        phone.includes(q) ||
        itemsText.includes(q)
      );
    });
  }, [orders, filterText, filterTab]);

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const queryWechatLive = async (params: { orderNo?: string; transactionId?: string; query?: string }) => {
    const raw = (params.query || params.orderNo || params.transactionId || '').trim();
    if (!raw) {
      setLiveResult({
        ok: false,
        title: '请输入要查询的单号',
        detail: '请粘贴商户订单号（如 LT... 或 CN2026...）或微信支付交易单号（如 420000... / 450000...）。',
      });
      return;
    }

    setSyncingKey(raw);
    setLiveResult(null);
    try {
      const response = await fetch('/api/cn/payments/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLiveResult({
          ok: false,
          title: '微信支付官方查单未通过',
          detail: data.error || '无法连接微信支付接口，请稍后重试',
        });
        return;
      }
      const tx = data.transaction || {};
      const amountYuan =
        typeof tx.amount?.total === 'number'
          ? (tx.amount.total / 100).toFixed(2)
          : data.order?.totalAmount || '0.00';
      setLiveResult({
        ok: Boolean(data.paid),
        title: data.paid
          ? `✅ 微信官方核验：已真实入账 ¥${amountYuan}`
          : `⏳ 微信官方状态：${tx.trade_state_desc || tx.trade_state || '未支付'}`,
        detail: data.message || '',
        transactionId: tx.transaction_id || data.order?.providerTransactionId,
        orderNo: tx.out_trade_no || data.order?.orderNo || raw,
        amountYuan: String(amountYuan),
        paidAt: tx.success_time || data.order?.paidAt,
        tradeState: tx.trade_state,
      });
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      setLiveResult({
        ok: false,
        title: '微信支付查单失败',
        detail: error instanceof Error ? error.message : '网络请求异常',
      });
    } finally {
      setSyncingKey(null);
    }
  };

  const syncAllPendingOrders = async () => {
    setSyncingKey('ALL_PENDING');
    setLiveResult(null);
    try {
      const response = await fetch('/api/cn/payments/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_all_pending' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLiveResult({
          ok: false,
          title: '批量核对失败',
          detail: data.error || '请稍后重试',
        });
        return;
      }
      setLiveResult({
        ok: true,
        title: `🔄 已向微信支付官方核对 ${data.checkedCount || 0} 笔待付订单`,
        detail:
          data.newlyPaidCount > 0
            ? `发现并自动入账 ${data.newlyPaidCount} 笔已支付订单！`
            : '所有待付款订单已与微信支付官方实时比对完毕。',
      });
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      setLiveResult({
        ok: false,
        title: '批量核对异常',
        detail: error instanceof Error ? error.message : '网络异常',
      });
    } finally {
      setSyncingKey(null);
    }
  };

  return (
    <section
      id="wechat-reconciliation"
      className="scroll-mt-4 rounded-xl border-2 border-emerald-700/80 bg-white p-5 shadow-sm"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
            <ShieldCheck className="h-4 w-4 text-emerald-700" />
            微信支付 APIv3 实时直连对账
          </div>
          <h2 className="mt-2 text-2xl font-black text-stone-950">
            💰 微信支付与订单对账中心 (WeChat Pay Reconciliation Center)
          </h2>
          <p className="mt-1 text-sm font-semibold text-stone-600">
            结算路径：
            <span className="font-black text-emerald-800">
              {computedSummary.settlementTarget}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isMemberView && (
            <button
              type="button"
              onClick={syncAllPendingOrders}
              disabled={syncingKey === 'ALL_PENDING'}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-50 px-3.5 py-2 text-xs font-black text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${syncingKey === 'ALL_PENDING' ? 'animate-spin' : ''}`}
              />
              ⚡ 一键核对全部待付订单
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-black text-stone-800 hover:bg-stone-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新账单
            </button>
          )}
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex items-center justify-between text-xs font-black text-emerald-900">
            <span>正式微信支付已到账总额 (¥)</span>
            <Wallet className="h-4 w-4 text-emerald-700" />
          </div>
          <div className="mt-2 text-3xl font-black text-emerald-800">
            {formatMoney(computedSummary.livePaidTotalYuan)}
          </div>
          <div className="mt-1 text-xs font-bold text-emerald-700">
            微信官方 APIv3 验签确认真实入账
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4">
          <div className="flex items-center justify-between text-xs font-black text-stone-600">
            <span>正式已入账笔数</span>
            <BadgeCheck className="h-4 w-4 text-emerald-700" />
          </div>
          <div className="mt-2 text-3xl font-black text-stone-950">
            {computedSummary.livePaidCount} <span className="text-base font-bold">笔</span>
          </div>
          <div className="mt-1 text-xs font-bold text-stone-500">
            {computedSummary.testPaidCount > 0
              ? `已自动剔除 ${computedSummary.testPaidCount} 笔测试/模拟单`
              : '全部为真实微信支付交易'}
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-center justify-between text-xs font-black text-amber-900">
            <span>待付款笔数</span>
            <Clock3 className="h-4 w-4 text-amber-700" />
          </div>
          <div className="mt-2 text-3xl font-black text-amber-800">
            {computedSummary.pendingCount} <span className="text-base font-bold">笔</span>
          </div>
          <div className="mt-1 text-xs font-bold text-amber-700">
            待付款总额 {formatMoney(computedSummary.pendingTotalYuan)}
          </div>
        </div>

        <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-4">
          <div className="flex items-center justify-between text-xs font-black text-teal-900">
            <span>结算银行与商户号</span>
            <Building2 className="h-4 w-4 text-teal-700" />
          </div>
          <div className="mt-2 text-lg font-black text-teal-950">
            农业银行对公（尾号 8694）
          </div>
          <div className="mt-1 text-xs font-bold text-teal-800">
            商户号 {computedSummary.merchantId}（苏州糙米量子）
          </div>
        </div>
      </div>

      {/* Search & Live WeChat APIv3 Query Bar */}
      <div className="mt-4 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <label className="block text-xs font-black text-stone-700">
            🔍 站内快速筛选（订单号 / 微信支付单号 / 会员 / 商品）
          </label>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-stone-400" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="输入 LT... / CN2026... / 450000... / 会员姓名筛选..."
              className="w-full bg-transparent text-sm font-semibold text-stone-900 outline-none"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText('')}
                className="text-xs font-bold text-stone-400 hover:text-stone-700"
              >
                清除
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-black text-emerald-900">
            🔄 微信支付官方实时查单补单（直连 api.mch.weixin.qq.com）
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2 sm:flex-nowrap">
            <input
              type="text"
              value={liveQueryInput}
              onChange={(e) => setLiveQueryInput(e.target.value)}
              placeholder="粘贴商户单号 (LT.../CN...) 或微信支付单号 (420000.../450000...)"
              className="min-w-0 flex-1 rounded-lg border border-emerald-600/60 bg-white px-3 py-2 text-sm font-semibold text-stone-900 outline-none focus:border-emerald-700"
            />
            <button
              type="button"
              onClick={() => void queryWechatLive({ query: liveQueryInput })}
              disabled={Boolean(syncingKey)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  syncingKey && syncingKey === liveQueryInput.trim() ? 'animate-spin' : ''
                }`}
              />
              🔄 向微信官方实时查单对账
            </button>
          </div>
        </div>
      </div>

      {/* Live Query Result Banner */}
      {liveResult && (
        <div
          className={`mt-3 rounded-lg border p-4 text-sm ${
            liveResult.ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-black">{liveResult.title}</div>
            <button
              type="button"
              onClick={() => setLiveResult(null)}
              className="text-xs font-bold underline opacity-75 hover:opacity-100"
            >
              关闭提示
            </button>
          </div>
          {liveResult.detail && (
            <p className="mt-1 text-xs font-semibold opacity-90">{liveResult.detail}</p>
          )}
          {(liveResult.orderNo || liveResult.transactionId) && (
            <div className="mt-2 grid gap-2 border-t border-current/10 pt-2 text-xs font-bold sm:grid-cols-2 lg:grid-cols-4">
              <div>商户单号：{liveResult.orderNo || '—'}</div>
              <div>微信支付单号：{liveResult.transactionId || '未生成（未支付）'}</div>
              <div>实付金额：¥{liveResult.amountYuan || '0.00'}</div>
              <div>
                到账时间：{liveResult.paidAt ? formatShanghaiTime(liveResult.paidAt) : '未支付'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: 'all' as const, label: `全部订单 (${orders.length})` },
            {
              key: 'live_paid' as const,
              label: `✅ 微信支付正式入账 (${computedSummary.livePaidCount})`,
            },
            { key: 'pending' as const, label: `⏳ 待付款 (${computedSummary.pendingCount})` },
            ...(computedSummary.testPaidCount > 0
              ? [
                  {
                    key: 'test' as const,
                    label: `🧪 测试/模拟 (${computedSummary.testPaidCount})`,
                  },
                ]
              : []),
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                filterTab === tab.key
                  ? 'bg-stone-950 text-white'
                  : 'border border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="text-xs font-bold text-stone-500">
          当前显示 {filteredOrders.length} 笔订单
        </div>
      </div>

      {/* Orders Table */}
      <div className="mt-3 overflow-x-auto">
        {filteredOrders.length === 0 ? (
          <div className="py-10 text-center text-sm font-bold text-stone-500">
            没有符合筛选条件的订单记录
          </div>
        ) : (
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-xs font-black text-stone-600">
                <th className="px-3 py-3">商户订单号 (orderNo)</th>
                <th className="px-3 py-3">微信支付交易单号 (transaction_id)</th>
                <th className="px-3 py-3">商品与买家信息</th>
                <th className="px-3 py-3 text-right">金额与入账性质</th>
                <th className="px-3 py-3">付款时间 / 结算去向</th>
                <th className="px-3 py-3 text-right">实时对账操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredOrders.slice(0, compact ? 12 : 100).map((order) => {
                const testMode = isOrderTestMode(order);
                const livePaid = isLiveWechatPaid(order);
                const isPaid = order.paymentStatus === 'paid';
                const txId = order.providerTransactionId || '';
                const buyerName =
                  order.buyerName || order.shippingName || (order.userId ? `会员 #${order.userId}` : '微信扫码客户');
                const buyerPhone = order.buyerPhone || order.shippingPhone || '';
                const productNames =
                  (order.items || [])
                    .map((item) =>
                      item.quantity && item.quantity > 1
                        ? `${item.productName} ×${item.quantity}`
                        : item.productName
                    )
                    .filter(Boolean)
                    .join('、') || '微信支付实测商品';
                const isSyncingThis = syncingKey === order.orderNo;

                return (
                  <tr
                    key={`${order.id}-${order.orderNo}`}
                    className={`transition hover:bg-stone-50/90 ${
                      livePaid ? 'bg-emerald-50/25' : ''
                    }`}
                  >
                    {/* 1. Order No */}
                    <td className="px-3 py-3.5 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-black text-stone-950">
                          {order.orderNo || `#${order.id}`}
                        </span>
                        {order.orderNo && (
                          <button
                            type="button"
                            onClick={() => void copyText(order.orderNo, `order-${order.id}`)}
                            title="复制商户订单号"
                            className="rounded p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                          >
                            {copiedKey === `order-${order.id}` ? (
                              <Check className="h-3.5 w-3.5 text-emerald-700" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-stone-500">
                        <span>内部ID #{order.id}</span>
                        <Link
                          href={`/cn/orders/${order.id}`}
                          className="inline-flex items-center gap-0.5 font-bold text-teal-700 hover:underline"
                        >
                          详情 <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </td>

                    {/* 2. WeChat Transaction ID */}
                    <td className="px-3 py-3.5 align-top">
                      {txId && !testMode ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-emerald-100/80 px-2 py-0.5 font-mono text-xs font-black text-emerald-950">
                              {txId}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copyText(txId, `tx-${order.id}`)}
                              title="复制微信支付单号"
                              className="rounded p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                            >
                              {copiedKey === `tx-${order.id}` ? (
                                <Check className="h-3.5 w-3.5 text-emerald-700" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                          <div className="mt-1 text-xs font-bold text-emerald-700">
                            微信官方流水号 · 可在微信支付后台核查
                          </div>
                        </div>
                      ) : testMode ? (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 font-mono text-xs font-bold text-stone-600">
                            {txId || '测试模拟无微信流水号'}
                          </span>
                          <div className="mt-1 text-xs font-semibold text-stone-400">
                            测试通道未产生真实扣款
                          </div>
                        </div>
                      ) : (
                        <div>
                          <span className="inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
                            等待客户微信扫码支付
                          </span>
                          <div className="mt-1 text-xs font-semibold text-stone-400">
                            支付成功后自动写入 4200/4500 开头单号
                          </div>
                        </div>
                      )}
                    </td>

                    {/* 3. Product & Buyer Info */}
                    <td className="px-3 py-3.5 align-top">
                      <div className="font-black text-stone-900">{productNames}</div>
                      <div className="mt-1 text-xs font-semibold text-stone-500">
                        买家：{buyerName}
                        {buyerPhone ? ` · ${buyerPhone}` : ''}
                      </div>
                    </td>

                    {/* 4. Amount & Badge */}
                    <td className="px-3 py-3.5 text-right align-top">
                      <div className="text-base font-black text-stone-950">
                        {formatMoney(order.totalAmount)}
                      </div>
                      <div className="mt-1.5 flex justify-end">
                        {livePaid ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-900">
                            ✅ 微信支付正式入账
                          </span>
                        ) : testMode ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-stone-100 px-2.5 py-0.5 text-xs font-black text-stone-700">
                            <FlaskConical className="h-3 w-3" />
                            🧪 测试/模拟
                          </span>
                        ) : isPaid ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2.5 py-0.5 text-xs font-black text-teal-900">
                            ✅ 已付款 ({order.paymentMethod === 'bank_transfer' ? '银行转账' : '其他'})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-black text-amber-900">
                            ⏳ 待付款
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 5. Paid Time & Settlement */}
                    <td className="px-3 py-3.5 align-top">
                      {order.paidAt ? (
                        <div className="text-xs font-black text-emerald-900">
                          到账：{formatShanghaiTime(order.paidAt)}
                        </div>
                      ) : (
                        <div className="text-xs font-semibold text-stone-500">
                          下单：{formatShanghaiTime(order.createdAt)}
                        </div>
                      )}
                      <div className="mt-1 text-xs font-bold text-stone-600">
                        {livePaid || (!testMode && order.paymentMethod !== 'bank_transfer') ? (
                          <span className="text-teal-800">
                            结算：商户 1118445617 → 农行对公 8694
                          </span>
                        ) : testMode ? (
                          <span className="text-stone-400">测试订单 · 不进入农行对公结算</span>
                        ) : (
                          <span>线下对公转账核对</span>
                        )}
                      </div>
                    </td>

                    {/* 6. Actions */}
                    <td className="px-3 py-3.5 text-right align-top">
                      <div className="flex flex-col items-end gap-1.5">
                        {(order.paymentMethod === 'wechat_pay' ||
                          order.paymentMethod === 'wechat_merchant' ||
                          !order.paymentMethod) && (
                          <button
                            type="button"
                            onClick={() => void queryWechatLive({ orderNo: order.orderNo })}
                            disabled={isSyncingThis}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-700 bg-white px-2.5 py-1 text-xs font-black text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${isSyncingThis ? 'animate-spin' : ''}`}
                            />
                            同步查账
                          </button>
                        )}
                        {onStatusChange && statusOptions && (
                          <select
                            value={order.status}
                            onChange={(e) => void onStatusChange(order.id, e.target.value)}
                            className="rounded border border-stone-300 bg-white px-2 py-1 text-xs font-bold text-stone-700"
                          >
                            {statusOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
