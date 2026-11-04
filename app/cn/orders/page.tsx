'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, RefreshCw, ShoppingBag, CheckCircle2, Clock, Truck } from 'lucide-react';
import { useAuth } from '@/app/providers';
import OrderPayPanel, { isOrderUnpaid } from '@/components/OrderPayPanel';

interface MemberOrderItem {
  id?: number;
  productId?: number;
  productName?: string;
  quantity?: number;
  unitPrice?: string | number;
}

interface MemberOrder {
  id: number;
  orderNo?: string;
  totalAmount?: string | number;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  shippingName?: string;
  shippingCity?: string;
  shippingAddress?: string;
  createdAt?: string;
  items?: MemberOrderItem[];
}

interface PrepayOrder {
  orderNo: string;
  applicationId: string;
  storeName: string;
  tier: string;
  isTest: boolean;
  amountYuan: number;
  uses: number;
  status: 'pending' | 'paid';
  paidAt?: string;
  expiresAt?: string;
  createdAt?: string;
}

function cnDateTime(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
}

function cnDate(value?: string) {
  return value ? new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
}

function statusLabel(status?: string, paymentStatus?: string) {
  if (paymentStatus === 'paid' || status === 'paid' || status === 'completed') {
    return { text: '已支付 · 待发货', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  }
  if (status === 'shipped') {
    return { text: '已发货 · 配送中', cls: 'bg-blue-100 text-blue-800 border-blue-200' };
  }
  if (status === 'cancelled') {
    return { text: '已取消', cls: 'bg-stone-100 text-stone-600 border-stone-200' };
  }
  return { text: '待付款', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
}

function paymentMethodLabel(method?: string) {
  if (method === 'wechat_pay') return '微信支付';
  if (method === 'alipay') return '支付宝';
  if (method === 'bank_transfer') return '银行转账';
  return '在线支付';
}

export default function ChinaOrdersPage() {
  const { user, isAdmin } = useAuth();
  const [orders, setOrders] = useState<MemberOrder[]>([]);
  const [prepayOrders, setPrepayOrders] = useState<PrepayOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const query = `/api/orders?userId=${user.id}&marketRegion=CN&currency=CNY`;
      const [res, prepayRes] = await Promise.all([
        fetch(query, { cache: 'no-store' }),
        fetch('/api/cn/store-prepay-orders', { cache: 'no-store' }).catch(() => null),
      ]);
      const data = await res.json().catch(() => ({}));
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      const prepayData = prepayRes && prepayRes.ok ? await prepayRes.json().catch(() => ({})) : {};
      setPrepayOrders(Array.isArray(prepayData.orders) ? prepayData.orders : []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  if (!user) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12 text-center">
        <Package size={48} className="mx-auto mb-4 text-gray-300" />
        <h1 className="mb-2 text-xl font-bold text-gray-800">请先登录会员账号</h1>
        <p className="mb-6 text-sm text-gray-500">登录后即可查看您的商城选购订单与物流配送进度</p>
        <Link href="/cn/login?next=%2Fcn%2Forders" className="btn-primary">
          前往登录
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f3ea]">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 text-sm font-semibold">
              <Link href="/cn/shop" className="text-amber-700 hover:text-amber-800">
                ← 返回糙米健康商城
              </Link>
              <span className="text-stone-300">|</span>
              <Link href="/cn/member" className="text-emerald-800 hover:text-emerald-900">
                返回会员中心
              </Link>
            </div>
            <h1 className="mt-2 text-3xl font-bold text-gray-950">
              我的订单
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              查看您在糙米健康商城的个人选购订单、门店预购次数（次卡）、付款状态与收货信息
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadOrders}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-bold text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新订单状态
            </button>
            {isAdmin && (
              <Link
                href="/cn/ops"
                className="rounded-xl bg-stone-950 px-4 py-2 text-xs font-bold text-white hover:bg-stone-800"
              >
                前往平台运营台 (/cn/ops)
              </Link>
            )}
          </div>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center text-stone-500">
              正在加载您的订单记录...
            </div>
          ) : orders.length === 0 && prepayOrders.length === 0 ? (
            <div className="rounded-3xl border border-stone-200/80 bg-white p-12 text-center shadow-xs">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShoppingBag className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-bold text-stone-900">暂无个人订单记录</h2>
              <p className="mt-1 text-sm text-stone-500">
                您还没有提交过商城订单，欢迎前往糙米健康商城选购健康好物
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Link
                  href="/cn/shop"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
                >
                  前往商城选购 →
                </Link>
                <Link
                  href="/cn/member"
                  className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-bold text-stone-700 hover:bg-stone-50"
                >
                  返回会员中心
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {prepayOrders.map((order) => (
                <Link
                  key={order.orderNo}
                  href={order.status === 'paid' ? '/cn/member#store-applications' : '/cn/member/store-application'}
                  className="block rounded-2xl border border-teal-200 bg-white p-5 shadow-xs transition hover:border-teal-600"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span className="rounded-full bg-teal-50 px-2.5 py-0.5 font-bold text-teal-800">预购次数（次卡）</span>
                      {order.isTest ? <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-bold text-amber-800">付款测试</span> : null}
                      <span className="font-mono font-semibold text-stone-800">订单号：{order.orderNo}</span>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-xs font-bold ${order.status === 'paid' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                      {order.status === 'paid' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                      {order.status === 'paid' ? '已付款' : '待付款'}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
                    <div><span className="text-stone-500">门店：</span><span className="font-bold text-stone-900">{order.storeName}</span></div>
                    <div><span className="text-stone-500">档位 / 次数：</span><span className="font-bold text-stone-900">{order.tier} 档 · {order.uses} 次</span></div>
                    <div><span className="text-stone-500">付款时间：</span>{order.status === 'paid' ? `${cnDateTime(order.paidAt)}（北京时间）` : '—'}</div>
                    <div><span className="text-stone-500">到期日：</span>{order.status === 'paid' ? cnDate(order.expiresAt) : '付款后起算 3 个月'}</div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3 text-xs text-stone-600">
                    <span className="font-bold text-teal-800">{order.status === 'paid' ? '查看申请进度 →' : '继续付款 →'}</span>
                    <div className="text-right">
                      <span className="text-stone-500">金额：</span>
                      <span className="text-base font-black text-emerald-900">¥{Number(order.amountYuan || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </Link>
              ))}
              {orders.map((order) => {
                const badge = statusLabel(order.status, order.paymentStatus);
                return (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-stone-200/90 bg-white p-5 shadow-xs transition hover:border-emerald-700/30"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
                      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                        <span className="font-mono font-semibold text-stone-800">
                          订单号：{order.orderNo || `CN-${order.id}`}
                        </span>
                        {order.createdAt && (
                          <span>
                            下单时间：{new Date(order.createdAt).toLocaleString('zh-CN')}
                          </span>
                        )}
                        <span>支付方式：{paymentMethodLabel(order.paymentMethod)}</span>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-xs font-bold ${badge.cls}`}>
                        {order.paymentStatus === 'paid' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : order.status === 'shipped' ? (
                          <Truck className="h-3.5 w-3.5" />
                        ) : (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                        {badge.text}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {Array.isArray(order.items) && order.items.length > 0 ? (
                        order.items.map((item, idx) => (
                          <div key={item.id || idx} className="flex items-center justify-between text-sm">
                            <span className="font-medium text-stone-900">
                              {item.productName || `商品 #${item.productId || idx + 1}`}
                              <span className="ml-2 text-xs text-stone-500">× {item.quantity || 1}</span>
                            </span>
                            <span className="font-semibold text-stone-800">
                              ¥{Number(item.unitPrice || 0).toFixed(2)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-stone-600">糙米健康商城订单商品</div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3 text-xs text-stone-600">
                      <div>
                        {order.shippingName ? (
                          <span>
                            收货人：{order.shippingName}（{[order.shippingCity, order.shippingAddress].filter(Boolean).join(' ')}）
                          </span>
                        ) : (
                          <span>门店自提 / 标准配送</span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-stone-500">订单总额：</span>
                        <span className="text-base font-black text-emerald-900">
                          ¥{Number(order.totalAmount || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    {isOrderUnpaid(order) ? (
                      <OrderPayPanel compact order={order} onOrderUpdated={(o) => setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...(o as MemberOrder) } : x)))} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
