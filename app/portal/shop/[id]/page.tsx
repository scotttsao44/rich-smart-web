'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { ShoppingCart, ArrowLeft, Package, Minus, Plus, Check } from 'lucide-react';
import { useCart } from '@/app/providers';

interface Product {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceTwd: string | null;
  priceCny: string | null;
  stockQuantity: number | null;
}

export default function ProductDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();

  useEffect(() => {
    if (!id) return;
    fetch(`/api/products/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then((data) => {
        setProduct(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleAddToCart = () => {
    if (!product) return;
    addItem({
      productId: product.id,
      name: product.name,
      price: Number(product.priceTwd || 0),
      quantity,
      imageUrl: product.imageUrl || undefined,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <Package size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">商品不存在</h2>
        <Link href="/portal/shop" className="btn-primary inline-block">
          返回商城
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link
        href="/portal/shop"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={16} />
        返回商城
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="relative w-full h-80 md:h-96 bg-gray-100 rounded-xl overflow-hidden">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-amber-50 to-cyan-50 text-gray-400">
              <Package size={64} />
              <span className="font-medium">等待商品图</span>
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{product.name}</h1>
          <p className="text-gray-500 mb-6 whitespace-pre-line">{product.description || '暂无描述'}</p>

          <div className="mb-6">
            <span className="text-3xl font-bold text-amber-600">
              NT${Number(product.priceTwd || 0).toLocaleString()}
            </span>
            {product.priceCny && (
              <span className="text-lg text-gray-400 ml-3">
                ¥{Number(product.priceCny).toLocaleString()}
              </span>
            )}
          </div>

          <div className="mb-6">
            <span className="text-sm text-gray-500">
              库存：{product.stockQuantity ?? 0} 件
            </span>
          </div>

          <div className="flex items-center gap-4 mb-8">
            <span className="text-sm font-medium text-gray-700">数量</span>
            <div className="flex items-center border border-gray-300 rounded-lg">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="px-3 py-2 hover:bg-gray-100 transition-colors"
              >
                <Minus size={16} />
              </button>
              <span className="px-4 py-2 font-medium min-w-[3rem] text-center">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity((q) => q + 1)}
                className="px-3 py-2 hover:bg-gray-100 transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <button
            onClick={handleAddToCart}
            className={`btn-primary flex items-center justify-center gap-2 py-3 text-lg ${
              added ? 'bg-green-600 hover:bg-green-700' : ''
            }`}
          >
            {added ? <Check size={20} /> : <ShoppingCart size={20} />}
            {added ? '已加入购物车！' : '加入购物车'}
          </button>

          {added && (
            <div className="mt-4 flex gap-3">
              <Link href="/cart" className="btn-secondary flex-1 text-center">
                去结账
              </Link>
              <Link href="/portal/shop" className="btn-outline flex-1 text-center">
                继续购物
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
