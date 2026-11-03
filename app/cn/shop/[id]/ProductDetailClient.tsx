'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, BadgeCheck, Check, Minus, Plus, ShoppingCart } from 'lucide-react';
import { useCart } from '@/app/providers';
import { formatCny, getCnyPrice } from '@/lib/cn-market';
import { PublicProduct } from '@/lib/product-public';
import ShopProductImage from '@/components/ShopProductImage';
import SharedDeviceLeadForm from '@/components/SharedDeviceLeadForm';
import CnReferralCapture from '@/components/CnReferralCapture';

export default function ProductDetailClient({ product }: { product: PublicProduct }) {
  const searchParams = useSearchParams();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const shared = product.listingType === 'shared_device';

  const addToCart = () => {
    if (shared) return;
    addItem({
      productId: product.id,
      name: product.name,
      price: getCnyPrice(product),
      quantity,
      imageUrl: product.imageUrl || undefined,
      currency: 'CNY',
      marketRegion: 'CN',
      referrerBrandId: Number(searchParams.get('referrerBrandId') || 0) || undefined,
      referrerBrandName: searchParams.get('referrerBrandName') || undefined,
      partnershipId: searchParams.get('partnershipId') || undefined,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  const cnyPrice = shared ? 0 : getCnyPrice(product);
  const referrerBrandId = Number(searchParams.get('referrerBrandId') || 0);
  const referrerBrandName = searchParams.get('referrerBrandName') || '';
  const referrerBrandSlug = searchParams.get('referrerBrandSlug') || '';
  const ownerBrandSlug = product.brandSlug || '';

  return (
    <main className="min-h-screen bg-[#f7f3ea]">
      <CnReferralCapture />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/cn/shop" className="mb-6 inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-amber-700">
          <ArrowLeft size={16} />
          返回商城
        </Link>

        <div className="grid gap-8 rounded-lg border border-amber-100 bg-white p-5 shadow-sm md:grid-cols-2 md:p-8">
          <div className="relative h-80 overflow-hidden rounded-lg bg-gray-100 md:h-96">
            <ShopProductImage src={product.imageUrl} alt={product.name} sizes="(min-width: 768px) 50vw, 100vw" />
            {product.imageIsTest ? <span className="absolute bottom-3 right-3 rounded bg-black/75 px-2 py-1 text-xs font-bold text-white">图片仅供参考</span> : null}
          </div>

          <section className="flex flex-col">
            <div className="flex flex-wrap items-center gap-3">
              {ownerBrandSlug ? <Link href={`/cn/brands/${ownerBrandSlug}?product=${product.id}`} className="text-sm font-black text-teal-800 hover:underline">商品品牌：{product.brandName || product.supplierName || '待确认'} ›</Link> : <div className="text-sm font-black text-teal-800">商品品牌：{product.brandName || product.supplierName || '待确认'}</div>}
              {referrerBrandId && referrerBrandSlug ? <Link href={`/cn/brands/${referrerBrandSlug}`} className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-900"><BadgeCheck className="h-4 w-4" />由{referrerBrandName || '合作品牌'}冠名推荐</Link> : null}
            </div>
            <h1 className="mt-2 text-3xl font-bold text-gray-950">{product.name}</h1>

            {shared ? (
              <>
                <div className="mt-6 rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-2xl font-black text-[var(--caomi-forest-900,#1f3d2b)]">投放合作 · 洽谈</p>
                  <p className="mt-1 text-sm font-bold text-emerald-800">共享设备{product.category ? ` · ${product.category}` : ''}</p>
                </div>
                {product.description ? (
                  <p className="mt-5 whitespace-pre-line rounded-lg bg-stone-50 p-4 text-sm font-semibold leading-6 text-stone-700">{product.description}</p>
                ) : null}
                {product.cooperationNote ? <div className="mt-4 whitespace-pre-line rounded-lg border border-stone-200 p-4 text-sm text-stone-600"><strong className="text-stone-900">合作方式：</strong>{product.cooperationNote}</div> : null}
                <SharedDeviceLeadForm productId={product.id} productName={product.name} refCode={searchParams.get('ref') || undefined} />
              </>
            ) : (
            <>
            <div className="mt-6 rounded-lg border border-amber-100 bg-amber-50 p-4">
              <p className="text-3xl font-bold text-amber-700">{formatCny(cnyPrice)}</p>
              {product.category ? <p className="mt-1 text-sm font-bold text-amber-800">{product.category}</p> : null}
            </div>

            {product.description ? (
              <p className="mt-5 rounded-lg bg-stone-50 p-4 text-sm font-semibold leading-6 text-stone-700">{product.description}</p>
            ) : null}
            {product.fulfillmentInfo ? <div className="mt-4 rounded-lg border border-stone-200 p-4 text-sm text-stone-600"><strong className="text-stone-900">发货说明：</strong>{product.fulfillmentInfo}</div> : null}

            <div className="mt-6 flex items-center gap-4">
              <span className="font-medium text-gray-700">数量</span>
              <div className="flex items-center rounded-lg border border-gray-300">
                <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="px-3 py-2 hover:bg-gray-50">
                  <Minus size={16} />
                </button>
                <span className="min-w-[3rem] px-4 py-2 text-center font-semibold">{quantity}</span>
                <button type="button" onClick={() => setQuantity((value) => value + 1)} className="px-3 py-2 hover:bg-gray-50">
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <button type="button" onClick={addToCart} className="btn-primary mt-8 flex items-center justify-center gap-2 py-3">
              {added ? <Check size={20} /> : <ShoppingCart size={20} />}
              {added ? '已加入购物车' : '加入购物车'}
            </button>

            {added && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Link href="/cn/cart" className="btn-secondary text-center">去结账</Link>
                <Link href="/cn/shop" className="btn-outline text-center">继续购物</Link>
              </div>
            )}
            </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
