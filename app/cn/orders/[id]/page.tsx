'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  CreditCard,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
import { formatCny } from '@/lib/cn-market';

interface OrderItem {
  id: number;
  productName: string | null;
  quantity: number | null;
  unitPrice: string;
}

interface Order {
  id: number;
  orderNo?: string | null;
  totalAmount: string;
  currency: string | null;
  status: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  paymentMode?: string | null;
  testMode?: boolean;
  providerTransactionId?: string | null;
  paidAt?: string | null;
  settlementTarget?: string | null;
  createdAt: string | null;
  shippingName: string | null;
  shippingPhone: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  trackingNumber: string | null;
  deliveredAt?: string | null;
  confirmedAt?: string | null;
  autoConfirmAt?: string | null;
  items: OrderItem[];
}

const statusLabels: Record<string, string> = {
  pending_payment: '等待付款',
  pending: '待付款',
  paid: '微信支付已入账',
  shipped: '已发货',
  delivered: '物流已送达',
  completed: '已完成',
  cancelled: '已取消',
};

export default function ChinaOrderDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const loadOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setOrder(data);
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const syncWithWechat = async () => {
    if (!order) return;
    setSyncing(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/cn/payments/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, orderNo: order.orderNo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionMessage(data.error || '微信支付查单失败');
        return;
      }
      if (data.order) setOrder(data.order);
      setActionMessage(
        data.paid
          ? `✅ 微信官方核验已到账！微信支付单号：${data.transaction?.transaction_id || data.order?.providerTransactionId}`
          : `⏳ 微信官方当前状态：${data.transaction?.trade_state_desc || data.tradeState || '待付款'}`
      );
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <p className="py-12 text-center text-gray-500">加载中...</p>;

  if (!order) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12 text-center">
        <Package size={48} className="mx-auto mb-4 text-gray-300" />
        <h1 className="mb-4 text-xl font-bold text-gray-800">订单不存在</h1>
        <Link href="/cn/orders" className="btn-primary">
          返回订单列表
        </Link>
      </main>
    );
  }

  const isPaid = order.paymentStatus === 'paid';
  const isTest = Boolean(order.testMode || order.paymentMode === 'test');
  const statusLabel =
    isPaid && !isTest
      ? '✅ 微信支付正式入账'
      : isTest
        ? '🧪 测试/模拟订单'
        : statusLabels[order.status || 'pending'] || '待付款';

  const confirmReceipt = async () => {
    const response = await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm_receipt' }),
    });
    const result = await response.json();
    if (!response.ok) return setActionMessage(result.error || '确认失败');
    setOrder(result.order);
    setActionMessage('已确认收货，符合条件的收益已转为可提现。');
  };

  return (
    <main className="min-h-screen bg-[#f7f3ea]">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link
          href="/cn/orders"
          className="mb-6 inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-amber-700"
        >
          <ArrowLeft size={16} />
          返回我的订单与对账中心
        </Link>

        <section className="rounded-lg border border-amber-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">
                CN Order · 商户订单号 {order.orderNo || `#${order.id}`}
              </p>
              <h1 className="mt-2 text-2xl font-bold text-gray-950">
                {order.orderNo || `订单 #${order.id}`}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                下单时间：
                {order.createdAt
                  ? `${new Date(order.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} (UTC+8)`
                  : '时间处理中'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-bold ${
                  isPaid && !isTest
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {statusLabel}
              </span>
              <button
                type="button"
                onClick={syncWithWechat}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700 bg-white px-4 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                向微信官方实时查单对账
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex items-center gap-2 font-black text-emerald-900">
              <ShieldCheck size={18} />
              {order.paymentMethod === 'bank_transfer'
                ? '银行对公转账'
                : '微信支付正式通道（商户号 1118445617 · 苏州糙米量子科技有限公司）'}
            </div>
            <div className="mt-3 grid gap-2 text-sm font-semibold text-stone-800 sm:grid-cols-2">
              <div>商户订单号：{order.orderNo || `#${order.id}`}</div>
              <div>
                微信支付交易单号：{order.providerTransactionId || '等待微信扫码支付返回'}
              </div>
              <div>
                付款到账时间：
                {order.paidAt
                  ? `${new Date(order.paidAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} (UTC+8)`
                  : '待支付'}
              </div>
              <div>
                结算去向：
                {order.settlementTarget ||
                  '商户号 1118445617（苏州糙米量子）→ 农业银行对公账户（尾号 8694）'}
              </div>
            </div>
            {isTest && (
              <p className="mt-2 text-xs font-bold text-amber-800">
                注：本订单为测试/模拟模式，未发生真实资金扣款。
              </p>
            )}
          </div>

          {order.status === 'delivered' && !order.confirmedAt ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-emerald-200 bg-emerald-50 p-4">
              <div>
                <div className="font-black text-emerald-900">商品已送达</div>
                <div className="mt-1 text-sm text-emerald-700">
                  {order.autoConfirmAt
                    ? `${new Date(order.autoConfirmAt).toLocaleString('zh-CN')} 将自动确认`
                    : '可立即确认收货'}
                </div>
              </div>
              <button
                onClick={confirmReceipt}
                className="bg-emerald-700 px-4 py-2 text-sm font-black text-white"
              >
                确认收货
              </button>
            </div>
          ) : null}
          {actionMessage ? (
            <div className="mt-3 rounded border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800">
              {actionMessage}
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-lg border border-amber-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-950">商品明细</h2>
          <div className="mt-4 space-y-4">
            {order.items?.map((item) => (
              <div key={item.id} className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-amber-50 text-gray-400">
                  <Package size={20} />
                </div>
                <div className="min-w-0 flex-grow">
                  <p className="truncate font-semibold text-gray-900">
                    {item.productName || '商品'}
                  </p>
                  <p className="text-sm text-gray-500">数量：{item.quantity || 1}</p>
                </div>
                <p className="font-bold text-gray-950">
                  {formatCny(Number(item.unitPrice) * (item.quantity || 1))}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-5 text-xl font-bold">
            <span>合计</span>
            <span className="text-amber-700">{formatCny(Number(order.totalAmount || 0))}</span>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-amber-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-950">收货信息</h2>
          <div className="mt-4 space-y-3 text-gray-600">
            <div className="flex items-center gap-3">
              <User size={16} />
              <span>{order.shippingName || '尚未填写'}</span>
            </div>
            <div className="flex items-center gap-3">
              <Phone size={16} />
              <span>{order.shippingPhone || '尚未填写'}</span>
            </div>
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-1" />
              <span>
                {[order.shippingCity, order.shippingAddress].filter(Boolean).join(' ') ||
                  '尚未填写'}
              </span>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-100 bg-white p-4">
            <Clock className="mb-3 text-amber-600" size={22} />
            <p className="font-bold text-gray-950">1. 微信扫码下单</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-white p-4">
            <CreditCard className="mb-3 text-amber-600" size={22} />
            <p className="font-bold text-gray-950">2. 微信支付实时对账</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-white p-4">
            <CheckCircle className="mb-3 text-amber-600" size={22} />
            <p className="font-bold text-gray-950">3. 安排配送与农行结算</p>
          </div>
        </section>
      </div>
    </main>
  );
}
