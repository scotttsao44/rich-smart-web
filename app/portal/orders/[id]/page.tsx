'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/app/providers';
import {
  ArrowLeft, Package, CreditCard, Clock, Truck, CheckCircle, XCircle,
  MapPin, Phone, User,
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
  shippedAt: string | null;
  deliveredAt: string | null;
  shippingAddress: string | null;
  shippingName: string | null;
  shippingPhone: string | null;
  trackingNumber: string | null;
  shippingCompany: string | null;
  items: OrderItem[];
}

const statusMap: Record<string, { label: string; color: string; step: number }> = {
  pending: { label: '待付款', color: 'text-amber-600 bg-amber-50 border-amber-200', step: 0 },
  paid: { label: '待发货', color: 'text-blue-600 bg-blue-50 border-blue-200', step: 1 },
  shipped: { label: '运送中', color: 'text-purple-600 bg-purple-50 border-purple-200', step: 2 },
  completed: { label: '已完成', color: 'text-green-600 bg-green-50 border-green-200', step: 3 },
  cancelled: { label: '已取消', color: 'text-gray-600 bg-gray-50 border-gray-200', step: -1 },
};

const trackingSteps = [
  { label: '订单确认', icon: CreditCard },
  { label: '打包中', icon: Package },
  { label: '已发货', icon: Truck },
  { label: '运送中', icon: Clock },
  { label: '已送达', icon: CheckCircle },
];

export default function OrderDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/orders/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then((data) => {
        setOrder(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <Package size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">订单不存在</h2>
        <Link href="/portal/orders" className="btn-primary inline-block">返回订单列表</Link>
      </div>
    );
  }

  const status = statusMap[order.status || 'pending'] || statusMap.pending;
  const isCancelled = order.status === 'cancelled';

  let currentStep = 0;
  if (order.status === 'paid') currentStep = 1;
  else if (order.status === 'shipped') currentStep = 3;
  else if (order.status === 'completed') currentStep = 4;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/portal/orders" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} /> 返回订单列表
      </Link>

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">订单 #{order.id}</h1>
            <p className="text-sm text-gray-500">
              下单时间：{order.createdAt ? new Date(order.createdAt).toLocaleString('zh-TW') : ''}
            </p>
          </div>
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${status.color}`}>
            {status.label}
          </span>
        </div>

        {order.status === 'pending' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-amber-800 mb-2">
              <CreditCard size={18} />
              <span className="font-medium">待付款</span>
            </div>
            <p className="text-sm text-amber-700 mb-3">
              请在 24 小时内完成付款，否则订单将自动取消。
            </p>
            <button className="btn-primary text-sm py-2 px-4">前往付款</button>
          </div>
        )}
      </div>

      {!isCancelled && (
        <div className="card mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">物流进度</h2>
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
            {trackingSteps.map((step, idx) => {
              const isActive = idx <= currentStep;
              const isCurrent = idx === currentStep;
              const Icon = step.icon;
              return (
                <div key={step.label} className="relative flex items-start gap-4 mb-6 last:mb-0">
                  <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isActive ? (isCurrent ? 'bg-amber-600 text-white' : 'bg-green-500 text-white') : 'bg-gray-200 text-gray-400'
                  }`}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className={`font-medium ${isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                      {step.label}
                      {isCurrent && <span className="ml-2 text-xs text-amber-600">当前状态</span>}
                    </p>
                    {idx === 2 && order.shippedAt && (
                      <p className="text-sm text-gray-500">{new Date(order.shippedAt).toLocaleString('zh-TW')}</p>
                    )}
                    {idx === 4 && order.deliveredAt && (
                      <p className="text-sm text-gray-500">{new Date(order.deliveredAt).toLocaleString('zh-TW')}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {order.trackingNumber && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2 text-gray-700 mb-2">
                <Truck size={16} />
                <span className="font-medium">物流信息</span>
              </div>
              <p className="text-sm text-gray-600">物流公司：{order.shippingCompany || '待更新'}</p>
              <p className="text-sm text-gray-600">追踪单号：{order.trackingNumber}</p>
            </div>
          )}
        </div>
      )}

      <div className="card mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">商品明细</h2>
        <div className="space-y-4">
          {order.items?.map((item) => (
            <div key={item.id} className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                <Package size={20} className="text-gray-400" />
              </div>
              <div className="flex-grow">
                <p className="font-medium text-gray-900">{item.productName || '商品'}</p>
                <p className="text-sm text-gray-500">数量：{item.quantity}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">NT${(Number(item.unitPrice) * (item.quantity || 1)).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 mt-4 pt-4">
          <div className="flex justify-between items-center text-lg font-bold">
            <span>合计</span>
            <span className="text-amber-600">NT${Number(order.totalAmount).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-bold text-gray-900 mb-4">收货信息</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-gray-600">
            <User size={16} /> <span>{order.shippingName || '尚未填写'}</span>
          </div>
          <div className="flex items-center gap-3 text-gray-600">
            <Phone size={16} /> <span>{order.shippingPhone || '尚未填写'}</span>
          </div>
          <div className="flex items-start gap-3 text-gray-600">
            <MapPin size={16} className="mt-0.5" /> <span>{order.shippingAddress || '尚未填写'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
