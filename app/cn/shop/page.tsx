'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Brain,
  ChevronRight,
  HeartPulse,
  Home,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  UserCircle,
} from 'lucide-react';
import { useAuth, useCart } from '@/app/providers';
import ChinaLogoutButton from '@/components/ChinaLogoutButton';
import CnMasterEntryBar from '@/components/CnMasterEntryBar';
import ChinaMobileTabBar from '@/components/ChinaMobileTabBar';
import ShopProductImage from '@/components/ShopProductImage';
import { formatCny, getCnyPrice } from '@/lib/cn-market';
import {
  SHOP_ALL_CATEGORY,
  SHOP_GUEST_HEALTH_CATEGORY,
  SHOP_PERSONAL_HEALTH_CATEGORY,
  buildVisibleShopCategories,
  filterShopProducts,
  productShopCategory,
  resolveActiveShopCategory,
  shopCategoryIsActive,
} from '@/lib/shop-categories';

interface Product {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceTwd: string | null;
  priceCny: string | null;
  stockQuantity: number | null;
  supplierName: string | null;
  brandId?: number | null;
  brandName?: string | null;
  brandSlug?: string | null;
  imageIsTest?: boolean;
  imageDisclosure?: string;
  category?: string;
  sold?: number;
  rating?: string;
  tag?: string;
  referrerBrandId?: number;
  referrerBrandName?: string;
  partnershipId?: string;
  listingType?: string;
  cooperationNote?: string;
}

function isShopProductRow(value: unknown): value is Product {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0) return false;
  if (typeof row.name !== 'string' || !row.name.trim()) return false;
  for (const key of ['description', 'imageUrl', 'priceTwd', 'priceCny', 'supplierName']) {
    if (row[key] !== null && typeof row[key] !== 'string') return false;
  }
  if (row.stockQuantity !== null && (typeof row.stockQuantity !== 'number'
    || !Number.isSafeInteger(row.stockQuantity) || row.stockQuantity < 0)) return false;
  for (const key of ['priceTwd', 'priceCny']) {
    if (typeof row[key] === 'string' && (!row[key].trim() || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) return false;
  }
  for (const key of ['category', 'brandName', 'brandSlug', 'imageDisclosure', 'rating', 'tag', 'referrerBrandName', 'partnershipId', 'listingType', 'cooperationNote']) {
    if (row[key] != null && typeof row[key] !== 'string') return false;
  }
  for (const key of ['brandId', 'referrerBrandId', 'sold']) {
    if (row[key] != null && (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || row[key] < 0)) return false;
  }
  if (row.imageIsTest != null && typeof row.imageIsTest !== 'boolean') return false;
  if (typeof row.imageUrl === 'string' && row.imageUrl && !row.imageUrl.startsWith('/')) {
    try {
      if (!['http:', 'https:'].includes(new URL(row.imageUrl).protocol)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

const healthCategory = SHOP_PERSONAL_HEALTH_CATEGORY;
const guestHealthCategory = SHOP_GUEST_HEALTH_CATEGORY;

const healthRecommendations = [
  {
    id: 'vitamin-c',
    category: '酵素调理',
    title: '六宝组合酵素',
    reason: '最近检测显示代谢与恢复需要连续追踪。',
    knowledge: '酵素类商品适合搭配饮食管理与门店回访，作为日常调理与三个月方案的主推品。',
    icon: ShieldCheck,
  },
  {
    id: 'sleep',
    category: '益生菌',
    title: '优菌80酵素益生菌',
    reason: '最近检测显示肠胃与外食状态需要保养。',
    knowledge: '益生菌偏向消化道日常保养，适合外食、作息不稳与需要建立复购习惯的会员。',
    icon: Brain,
  },
  {
    id: 'metabolism',
    category: '代餐管理',
    title: '享so代餐组合装',
    reason: '最近检测显示饮食控制与体态管理可以加强。',
    knowledge: '代餐组合适合搭配三个月集中方案，让门店回访、产品复购与健康记录接在一起。',
    icon: Activity,
  },
];

function productSold(product: Product) {
  return product.sold ?? 0;
}

function productRating(product: Product) {
  return product.rating || '4.8';
}

export default function ChinaShopPage() {
  const [apiProducts, setApiProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [activeCategory, setActiveCategory] = useState(SHOP_ALL_CATEGORY);
  const [query, setQuery] = useState('');
  const [addedId, setAddedId] = useState<number | null>(null);
  const [healthProfile, setHealthProfile] = useState({ loaded: false, hasRecord: false, blocked: false, advice: '' });
  const { user } = useAuth();
  const { addItem, items } = useCart();
  const hasPersonalHealthContext = Boolean(user && healthProfile.hasRecord && !healthProfile.blocked);
  const healthRecommendationBlocked = Boolean(user && healthProfile.hasRecord && healthProfile.blocked);
  const products = apiProducts;
  const visibleCategories = useMemo(
    () => buildVisibleShopCategories(products, hasPersonalHealthContext),
    [hasPersonalHealthContext, products],
  );
  const activeCategoryLabel = resolveActiveShopCategory(activeCategory, visibleCategories);

  useEffect(() => {
    const category = new URLSearchParams(window.location.search).get('category');
    if (category) {
      setActiveCategory(category);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setHealthProfile({ loaded: true, hasRecord: false, blocked: false, advice: '' });
      return;
    }
    fetch('/api/cn/workspaces/member').then(async (response) => response.ok ? response.json() : null).then((workspace) => {
      const latest = Array.isArray(workspace?.health) ? workspace.health[0] : null;
      setHealthProfile({ loaded: true, hasRecord: Boolean(latest), blocked: Boolean(latest?.recommendationBlocked), advice: String(latest?.advice || '') });
    }).catch(() => setHealthProfile({ loaded: true, hasRecord: false, blocked: false, advice: '' }));
  }, [user]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setProductsError('');
    fetch('/api/products', { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data) || !data.every(isShopProductRow)) throw new Error('商品暂时无法读取，请重试');
        if (!controller.signal.aborted) setApiProducts(data);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setApiProducts([]);
        setProductsError('商品暂时无法读取，请重试');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if (loading) return;
    const resolved = resolveActiveShopCategory(activeCategory, visibleCategories);
    if (resolved === activeCategoryLabel && activeCategory === resolved) return;
    setActiveCategory(resolved);
    const url = new URL(window.location.href);
    if (url.searchParams.has('category')) {
      if (resolved === SHOP_ALL_CATEGORY) {
        url.searchParams.delete('category');
      } else {
        url.searchParams.set('category', resolved);
      }
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [activeCategory, activeCategoryLabel, loading, visibleCategories]);

  const filteredProducts = useMemo(() => {
    return filterShopProducts(products, activeCategoryLabel, query) as Product[];
  }, [activeCategoryLabel, products, query]);

  const addToCart = (product: Product) => {
    if (product.listingType === 'shared_device') return;
    addItem({
      productId: product.id,
      name: product.name,
      price: getCnyPrice(product),
      quantity: 1,
      imageUrl: product.imageUrl || undefined,
      currency: 'CNY',
      marketRegion: 'CN',
      referrerBrandId: product.referrerBrandId,
      referrerBrandName: product.referrerBrandName,
      partnershipId: product.partnershipId,
    });
    setAddedId(product.id);
    setTimeout(() => setAddedId(null), 1600);
  };

  const productHref = (product: Product) => {
    const params = new URLSearchParams();
    if (product.referrerBrandId) params.set('referrerBrandId', String(product.referrerBrandId));
    if (product.referrerBrandName) params.set('referrerBrandName', product.referrerBrandName);
    if (product.partnershipId) params.set('partnershipId', product.partnershipId);
    const queryString = params.toString();
    return `/cn/shop/${product.id}${queryString ? `?${queryString}` : ''}`;
  };

  return (
    <main className="min-h-screen bg-[var(--caomi-page)] pb-20">
      <header className="sticky top-0 z-30 border-b border-[#dce3d8] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link href="/cn/shop" className="flex shrink-0 items-center gap-2 text-xl font-black text-[var(--caomi-forest-900)]">
            <Image src="/images/caomi-logo.png" alt="糙米" width={136} height={122} priority className="h-9 w-9 rounded-lg object-contain" />
            <span className="hidden sm:inline">糙米</span>
          </Link>
          <Link href="/cn/home" className="hidden shrink-0 items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-sm font-black text-stone-700 md:inline-flex">
            <Home className="h-4 w-4" />
            首页
          </Link>
          <Link href="/cn/member" className="hidden shrink-0 items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-sm font-black text-stone-700 md:inline-flex">
            <UserCircle className="h-4 w-4" />
            会员中心
          </Link>
          <Link href="/cn/brand/apply" className="hidden shrink-0 rounded-lg border border-stone-200 px-3 py-2 text-sm font-black text-stone-700 lg:inline-flex">品牌入驻</Link>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-stone-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-lg border border-[#dce3d8] bg-[#f6f8f4] pl-10 pr-3 text-sm outline-none focus:border-[var(--caomi-leaf-700)] focus:bg-white"
              placeholder="搜索商品、营养、睡眠、肩颈"
            />
          </div>
          <Link href="/cn/cart" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--caomi-forest-900)] text-white hover:bg-[var(--caomi-forest-700)]" aria-label="购物车">
            <ShoppingCart className="h-5 w-5" />
            {items.length ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-black">{items.length}</span> : null}
          </Link>
          <div className="hidden md:block">
            <ChinaLogoutButton />
          </div>
        </div>
      </header>
      <CnMasterEntryBar />

      <section className="mx-auto max-w-7xl px-4 py-5">
        <div className="rounded-lg border border-[var(--caomi-forest-700)] border-b-4 border-b-[var(--caomi-gold-600)] bg-[var(--caomi-forest-900)] p-5 text-white shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--caomi-gold-100)] px-3 py-1 text-xs font-bold text-[var(--caomi-forest-950)]">
                <HeartPulse className="h-4 w-4" />
                {healthRecommendationBlocked ? '本次检测不生成商品推荐' : hasPersonalHealthContext ? '根据最近一次有效检测结果' : '健康优选专区'}
              </div>
              <h1 className="mt-4 text-3xl font-black">
                {healthRecommendationBlocked ? '请先咨询专业医疗人员' : hasPersonalHealthContext ? '根据你的健康状况推荐' : '精准推荐适合你的产品'}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setActiveCategory(hasPersonalHealthContext ? healthCategory : guestHealthCategory)}
              disabled={!visibleCategories.some((category) => shopCategoryIsActive(hasPersonalHealthContext ? healthCategory : guestHealthCategory, category))}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--caomi-gold-200)] bg-white px-4 py-3 text-sm font-black text-[var(--caomi-forest-950)]"
            >
              {hasPersonalHealthContext ? '查看推荐商品' : '查看推荐专区'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {hasPersonalHealthContext ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {healthRecommendations.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
              onClick={() => setActiveCategory(item.category)}
              disabled={!visibleCategories.includes(item.category)}
              className="rounded-lg border border-stone-200 bg-white p-4 text-left shadow-sm hover:border-[var(--caomi-leaf-700)]"
            >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--caomi-leaf-50)] text-[var(--caomi-forest-700)]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="font-black text-stone-950">{item.title}</div>
                      <div className="mt-1 text-xs font-bold text-amber-700">{item.category}</div>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-stone-400" />
                </div>
                <p className="mt-4 text-sm font-semibold leading-6 text-stone-700">{item.reason}</p>
                <p className="mt-2 text-sm leading-6 text-stone-500">{item.knowledge}</p>
              </button>
            );
            })}
          </div>
        ) : healthRecommendationBlocked ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 font-bold leading-6 text-red-800">{healthProfile.advice}</div> : null}
      </section>

      <section className="mx-auto max-w-7xl px-4">
        <div className="flex gap-2 overflow-x-auto pb-3">
          {visibleCategories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${shopCategoryIsActive(activeCategoryLabel, category) ? 'bg-[var(--caomi-forest-900)] text-white' : 'border border-stone-200 bg-white text-stone-700 hover:border-[var(--caomi-leaf-700)]'}`}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="mt-2">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-black text-stone-950">{activeCategoryLabel}</h2>
              <span className="text-sm font-bold text-stone-500">{loading ? '读取中' : productsError ? '读取失败' : `${filteredProducts.length} 件商品`}</span>
            </div>

            {loading ? (
              <p className="rounded-lg bg-white py-12 text-center text-stone-500">加载商品中...</p>
            ) : productsError ? (
              <div role="alert" className="rounded-lg border border-amber-200 bg-white p-6 text-center text-stone-700">
                <p className="font-semibold">{productsError}</p>
                <button type="button" aria-label="重新加载商品" onClick={() => setReloadToken((value) => value + 1)} className="mt-4 inline-flex items-center gap-2 rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
                  <RefreshCw className="h-4 w-4" />重新加载
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
                <Package size={44} className="mx-auto mb-3 text-stone-300" />
                <p className="font-semibold text-stone-700">目前没有符合条件的商品</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {filteredProducts.map((product) => {
                  const shared = product.listingType === 'shared_device';
                  const cnyPrice = shared ? 0 : getCnyPrice(product);
                  return (
                    <article key={product.id} className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
                      <Link href={productHref(product)} className="block">
                        <div className="relative aspect-square overflow-hidden bg-stone-100">
                          <ShopProductImage src={product.imageUrl} alt={product.name} sizes="(min-width: 1280px) 300px, (min-width: 1024px) 33vw, 50vw" className="object-cover transition-transform hover:scale-105" />
                          <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-1 text-xs font-black text-white">{product.tag || '推荐'}</span>
                          {product.referrerBrandId ? <span className="absolute right-2 top-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900">由{product.referrerBrandName || '合作品牌'}冠名推荐</span> : null}
                          {product.imageIsTest ? <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[11px] font-bold text-white">图片仅供参考</span> : null}
                        </div>
                        <div className="p-3">
                          <div className="mb-2 text-xs font-black text-[var(--caomi-forest-700)]">商品品牌：{product.brandName || product.supplierName || '待确认'}</div>
                          <div className="line-clamp-2 min-h-[44px] font-black leading-6 text-stone-950">{product.name}</div>
                          {shared ? (
                            <div className="mt-2 text-xs font-bold text-[var(--caomi-forest-700)]">共享设备 · 投放合作</div>
                          ) : (
                            <div className="mt-2 flex items-center gap-1 text-xs font-bold text-amber-600">
                              <Star className="h-3.5 w-3.5 fill-amber-500" />
                              {productRating(product)} · 已售 {productSold(product)}
                            </div>
                          )}
                          <p className="mt-2 line-clamp-2 min-h-[40px] text-xs leading-5 text-stone-500">{product.description}</p>
                        </div>
                      </Link>

                      {shared ? (
                        <div className="flex items-end justify-between gap-2 px-3 pb-3">
                          <div>
                            <p className="text-base font-black text-[var(--caomi-forest-900)]">投放合作 · 洽谈</p>
                            <p className="text-xs font-semibold text-stone-400">{productShopCategory(product)}</p>
                          </div>
                          <Link href={productHref(product)} className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-[var(--caomi-forest-900)] px-3 text-xs font-black text-white hover:bg-[var(--caomi-leaf-700)]">
                            留资料洽谈
                          </Link>
                        </div>
                      ) : (
                      <div className="flex items-end justify-between gap-2 px-3 pb-3">
                        <div>
                          <p className="text-xl font-black text-red-600">{formatCny(cnyPrice)}</p>
                          <p className="text-xs font-semibold text-stone-400">{productShopCategory(product)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addToCart(product)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--caomi-forest-900)] text-white hover:bg-[var(--caomi-leaf-700)]"
                          aria-label="加入购物车"
                        >
                          {addedId === product.id ? <Sparkles size={17} /> : <ShoppingCart size={17} />}
                        </button>
                      </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
      <ChinaMobileTabBar active="shop" />
    </main>
  );
}
