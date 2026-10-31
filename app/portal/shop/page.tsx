'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart, Package } from 'lucide-react';
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

export default function ShopPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { addItem } = useCart();

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => {
        setProducts(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const [addedId, setAddedId] = useState<number | null>(null);

  const handleAddToCart = (product: Product) => {
    addItem({
      productId: product.id,
      name: product.name,
      price: Number(product.priceTwd || 0),
      quantity: 1,
      imageUrl: product.imageUrl || undefined,
    });
    setAddedId(product.id);
    setTimeout(() => setAddedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <Package size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">暂无商品</h2>
        <p className="text-gray-500 mb-6">目前商城尚未上架商品，请联系管理员或稍后再来。</p>
        <Link href="/login" className="btn-primary inline-block">
          管理员登录
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">健康选品商城</h1>
      <p className="text-gray-500 mb-6">为您精选优质养生产品</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => (
          <div key={product.id} className="card flex flex-col">
            <Link href={`/portal/shop/${product.id}`} className="block mb-4">
              <div className="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden">
                {product.imageUrl ? (
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-50 to-cyan-50 text-gray-400">
                    <Package size={32} />
                    <span className="text-xs font-medium">等待商品图</span>
                  </div>
                )}
              </div>
            </Link>

            <Link href={`/portal/shop/${product.id}`} className="block mb-2">
              <h3 className="text-lg font-semibold text-gray-900 hover:text-amber-600 transition-colors">
                {product.name}
              </h3>
            </Link>

            <p className="text-sm text-gray-500 mb-4 line-clamp-2 flex-grow">
              {product.description || '暂无描述'}
            </p>

            <div className="flex items-center justify-between mt-auto mb-4">
              <div>
                <span className="text-xl font-bold text-amber-600">
                  NT${Number(product.priceTwd || 0).toLocaleString()}
                </span>
                {product.priceCny && (
                  <span className="text-sm text-gray-400 ml-2">
                    ¥{Number(product.priceCny).toLocaleString()}
                  </span>
                )}
              </div>
              {product.stockQuantity !== null && product.stockQuantity <= 5 && product.stockQuantity > 0 && (
                <span className="text-xs text-red-500">仅剩 {product.stockQuantity} 件</span>
              )}
            </div>

            <div className="flex gap-2 mt-auto">
              <Link
                href={`/portal/shop/${product.id}`}
                className="btn-outline flex-1 text-center text-sm py-2"
              >
                查看详情
              </Link>
              <button
                onClick={() => handleAddToCart(product)}
                disabled={addedId === product.id}
                className={`flex items-center justify-center gap-1 flex-1 text-sm py-2 rounded-lg transition-colors ${
                  addedId === product.id
                    ? 'bg-green-600 text-white'
                    : 'btn-primary'
                }`}
              >
                {addedId === product.id ? '✓ 已加入' : (
                  <><ShoppingCart size={14} /> 加入购物车</>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
