'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/providers';
import {
  Package, ArrowRight, Clock, Truck, CheckCircle, CreditCard,
  XCircle, AlertTriangle,
} from 'lucide-react';

interface OrderItem {
  id: number;
  productName: string | null;
  quantity: number | null;
  unitPrice: string;
}

interface Order {
  id: number;
  totalAmount: string;
  currency: string | null;
  status: string | null;
  createdAt: string | null;
  trackingNumber: string | null;
  shippingCompany: string | null;
  items: OrderItem[];
}

const statusMap: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: '待付款', color: 'bg-amber-100 text-amber-800', icon: CreditCard },
  paid: { label: '待发货', color: 'bg-blue-100 text-blue-800', icon: Clock },
  shipped: { label: '运送中', color: 'bg-purple-100 text-purple-800', icon: Truck },
  completed: { label: '已完成', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-800', icon: XCircle },
};

function StatusBadge({ status }: { status: string | null }) {
  const s = statusMap[status || 'pending'] || statusMap.pending;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${s.color}`}>
      <Icon size={12} />
      {s.label}
    </span>
  );
}

export default function OrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetch(`/api/orders?userId=${user.id}`)
        .then((res) => res.json())
        .then((data) => {
          setOrders(data.orders || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">请先登录</h2>
        <Link href="/login" className="btn-primary">前往登录</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <Package size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">暂无订单</h2>
        <p className="text-gray-500 mb-6">您还没有下过任何订单</p>
        <Link href="/portal/shop" className="btn-primary inline-block">去商城逛逛</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">我的订单</h1>

      <div className="space-y-4">
        {orders.map((order) => {
          const itemCount = order.items?.reduce((sum, i) => sum + (i.quantity || 0), 0) || 0;
          const firstItem = order.items?.[0];

          return (
            <div key={order.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-500">订单编号 #{order.id}</p>
                  <p className="text-xs text-gray-400">
                    {order.createdAt ? new Date(order.createdAt).toLocaleDateString('zh-TW') : ''}
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Package size={20} className="text-gray-400" />
                </div>
                <div className="flex-grow">
                  <p className="text-sm font-medium text-gray-900">
                    {firstItem?.productName || '商品'}
                    {itemCount > 1 && ` 等 ${itemCount} 件商品`}
                  </p>
                  <p className="text-sm text-gray-500">
                    共 {itemCount} 件 · 合计 NT${Number(order.totalAmount).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                {order.status === 'pending' && (
                  <Link
                    href={`/portal/orders/${order.id}`}
                    className="btn-primary text-sm py-2 px-4"
                  >
                    立即付款
                  </Link>
                )}
                {order.status === 'shipped' && order.trackingNumber && (
                  <div className="text-sm text-gray-600">
                    <Truck size={14} className="inline mr-1" />
                    {order.shippingCompany} · {order.trackingNumber}
                  </div>
                )}
                {order.status !== 'pending' && order.status !== 'shipped' && (
                  <span className="text-sm text-gray-400">
                    {statusMap[order.status || '']?.label}
                  </span>
                )}
                <Link
                  href={`/portal/orders/${order.id}`}
                  className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1"
                >
                  查看详情 <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
