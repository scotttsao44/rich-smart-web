'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import { useRouter } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import WechatPayReconciliationCenter, { ReconcileOrderItem } from '@/components/WechatPayReconciliationCenter';
import StorePrepayOrdersAdmin from '@/components/StorePrepayOrdersAdmin';

interface OrderRow {
  orders: {
    id: number;
    orderNo?: string | null;
    userId: number;
    buyerName?: string | null;
    buyerPhone?: string | null;
    totalAmount: string;
    currency: string;
    status: string;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    paymentMode?: string | null;
    testMode?: boolean;
    providerTransactionId?: string | null;
    paidAt?: string | null;
    shippingName?: string | null;
    shippingPhone?: string | null;
    commissionProcessed: boolean;
    createdAt: string;
    items?: Array<{
      id?: number;
      productName?: string | null;
      quantity?: number | null;
      unitPrice?: string | number;
    }>;
  };
  users: {
    id: number;
    name: string | null;
    phone: string | null;
  } | null;
}

const statusMap: Record<string, string> = {
  pending: '待付款',
  paid: '已付款',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
};

const statusOptions = [
  { value: 'pending', label: '待付款' },
  { value: 'paid', label: '已付款' },
  { value: 'shipped', label: '已发货' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

export default function AdminOrders() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/orders', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setOrders(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/login?mode=admin&next=%2Fadmin%2Forders');
      return;
    }
    void fetchOrders();
  }, [isAdmin, router, fetchOrders]);

  const handleStatusChange = async (orderId: number, newStatus: string) => {
    setMessage('');
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, status: newStatus }),
      });
      if (res.ok) {
        setMessage(`订单 #${orderId} 状态已更新为 ${statusMap[newStatus] || newStatus}`);
        await fetchOrders();
      } else {
        setMessage('更新失败');
      }
    } catch {
      setMessage('更新失败');
    }
  };

  const reconcileOrders = useMemo<ReconcileOrderItem[]>(() => {
    return orders.map((row) => ({
      ...row.orders,
      orderNo: row.orders.orderNo || `#${row.orders.id}`,
      buyerName: row.orders.buyerName || row.orders.shippingName || row.users?.name || '中国站会员',
      buyerPhone: row.orders.buyerPhone || row.orders.shippingPhone || row.users?.phone || '',
    }));
  }, [orders]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShoppingBag size={24} className="text-amber-600" />
          <h1 className="text-2xl font-bold text-gray-900">订单管理与微信支付对账中心</h1>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          {message}
        </div>
      )}

      {loading ? (
        <div className="card py-10 text-center text-gray-500">加载订单与微信对账数据中...</div>
      ) : (
        <WechatPayReconciliationCenter
          orders={reconcileOrders}
          onRefresh={fetchOrders}
          onStatusChange={handleStatusChange}
          statusOptions={statusOptions}
        />
      )}

      <StorePrepayOrdersAdmin fetchAll />
    </div>
  );
}
