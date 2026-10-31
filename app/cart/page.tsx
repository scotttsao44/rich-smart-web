'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart, useAuth } from '@/app/providers';
import {
  ShoppingCart, Trash2, Minus, Plus, Package, ArrowRight, CheckCircle,
} from 'lucide-react';

export default function CartPage() {
  const { items, removeItem, updateQuantity, totalAmount, clearCart } = useCart();
  const { user } = useAuth();
  const router = useRouter();
  const [checkingOut, setCheckingOut] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);

  const handleCheckout = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (items.length === 0) return;

    setCheckingOut(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.price,
          })),
          currency: 'TWD',
        }),
      });

      if (!res.ok) throw new Error('订单建立失败');

      const data = await res.json();
      clearCart();
      setOrderId(data.orderId);
    } catch (err) {
      alert('结账失败，请稍后再试');
    } finally {
      setCheckingOut(false);
    }
  };

  if (orderId) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">订单已建立！</h2>
        <p className="text-gray-500 mb-2">订单编号：#{orderId}</p>
        <p className="text-gray-500 mb-6">请前往订单详情完成付款</p>
        <div className="flex gap-4 justify-center">
          <Link href={`/portal/orders/${orderId}`} className="btn-primary">
            前往付款
          </Link>
          <Link href="/portal/orders" className="btn-outline">
            查看所有订单
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <ShoppingCart size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">购物车是空的</h2>
        <p className="text-gray-500 mb-6">快去商城选购心仪的商品吧！</p>
        <Link href="/portal/shop" className="btn-primary inline-block">
          前往商城
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">购物车</h1>

      <div className="space-y-4 mb-8">
        {items.map((item) => (
          <div key={item.productId} className="card flex items-center gap-4">
            <div className="relative w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.name}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <Package size={20} />
                </div>
              )}
            </div>

            <div className="flex-grow min-w-0">
              <h3 className="font-semibold text-gray-900 truncate">{item.name}</h3>
              <p className="text-sm text-gray-500">NT${item.price.toLocaleString()}</p>
            </div>

            <div className="flex items-center border border-gray-300 rounded-lg flex-shrink-0">
              <button onClick={() => updateQuantity(item.productId, item.quantity - 1)} className="px-2 py-1 hover:bg-gray-100">
                <Minus size={14} />
              </button>
              <span className="px-3 py-1 text-sm font-medium min-w-[2rem] text-center">{item.quantity}</span>
              <button onClick={() => updateQuantity(item.productId, item.quantity + 1)} className="px-2 py-1 hover:bg-gray-100">
                <Plus size={14} />
              </button>
            </div>

            <div className="text-right min-w-[6rem] flex-shrink-0">
              <p className="font-semibold text-gray-900">NT${(item.price * item.quantity).toLocaleString()}</p>
            </div>

            <button onClick={() => removeItem(item.productId)} className="p-2 text-gray-400 hover:text-red-500">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      <div className="card bg-gray-50">
        <div className="flex justify-between items-center mb-4">
          <span className="text-gray-600">小计</span>
          <span className="font-semibold">NT${totalAmount.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">运费</span>
          <span className="font-semibold text-green-600">包邮</span>
        </div>
        <div className="border-t border-gray-200 pt-4 flex justify-between items-center mb-6 text-lg font-bold">
          <span>合计</span>
          <span className="text-amber-600">NT${totalAmount.toLocaleString()}</span>
        </div>
        <button
          onClick={handleCheckout}
          disabled={checkingOut}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50"
        >
          {checkingOut ? '处理中...' : '结账'}
          <ArrowRight size={18} />
        </button>
        {!user && (
          <p className="text-sm text-gray-500 text-center mt-3">
            结账前请先 <Link href="/login" className="text-amber-600 hover:underline">登录</Link>
          </p>
        )}
      </div>
    </div>
  );
}
