'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CalendarClock,
  ChevronRight,
  HeartPulse,
  Home,
  LocateFixed,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  UserCircle,
  WalletCards,
} from 'lucide-react';
import { useAuth, useCart } from '@/app/providers';
import ChinaLogoutButton from '@/components/ChinaLogoutButton';
import CnMasterEntryBar from '@/components/CnMasterEntryBar';
import ChinaMobileTabBar from '@/components/ChinaMobileTabBar';
import ShopProductImage from '@/components/ShopProductImage';
import { formatCny, getCnyPrice } from '@/lib/cn-market';
import {
  SHOP_GUEST_HEALTH_CATEGORY,
  SHOP_PERSONAL_HEALTH_CATEGORY,
  buildVisibleShopCategories,
  filterShopProducts,
  productShopCategory,
} from '@/lib/shop-categories';

type Product = {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceTwd: string | null;
  priceCny: string | null;
  stockQuantity: number | null;
  supplierName: string | null;
  brandName?: string | null;
  brandSlug?: string | null;
  imageIsTest?: boolean;
  category?: string;
  tag?: string;
};

type HealthRecord = {
  id?: string;
  category?: string;
  advice?: string;
  recommendationBlocked?: boolean;
  source?: string;
  createdAt?: string;
};

type Workspace = {
  health?: HealthRecord[];
  appointments?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  commissions?: Array<Record<string, unknown>>;
  notifications?: Array<Record<string, unknown>>;
};

type StoreApplication = {
  id: string;
  name?: string;
  address?: string;
  status?: string;
};

const navLinks = [
  { href: '/cn/home', label: '首页', icon: Home },
  { href: '/cn/shop', label: '商城', icon: ShoppingBag },
  { href: '/cn/member', label: '会员中心', icon: UserCircle },
  { href: '/cn/cart', label: '购物车', icon: ShoppingCart },
] as const;

const serviceLinks = [
  {
    href: '/cn/member',
    title: '会员中心',
    detail: '查看订单、推荐码、门店参与记录与通知。',
    icon: UserCircle,
  },
  {
    href: '/cn/orders',
    title: '我的订单',
    detail: '继续追踪已建立的商城订单与履约状态。',
    icon: Package,
  },
  {
    href: '/cn/member/wallet',
    title: '分润钱包',
    detail: '进入已开通的钱包与提现记录。',
    icon: WalletCards,
  },
  {
    href: '/cn/cart',
    title: '购物车',
    detail: '回到购物车继续结算已加入的商品。',
    icon: ShoppingCart,
  },
] as const;

function productHref(product: Product) {
  return `/cn/shop/${product.id}`;
}

function uniqueCategories(products: Product[]) {
  return buildVisibleShopCategories(products, false).filter((category) => category !== '全部');
}

function isHomeProductRow(value: unknown): value is Product {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0
    || typeof row.name !== 'string' || !row.name.trim()) return false;
  for (const key of ['description', 'imageUrl', 'priceTwd', 'priceCny', 'supplierName']) {
    if (row[key] !== null && typeof row[key] !== 'string') return false;
  }
  for (const key of ['priceTwd', 'priceCny']) {
    if (typeof row[key] === 'string' && (!row[key].trim() || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) return false;
  }
  if (row.stockQuantity !== null && (typeof row.stockQuantity !== 'number' || !Number.isSafeInteger(row.stockQuantity) || row.stockQuantity < 0)) return false;
  for (const key of ['category', 'brandName', 'brandSlug', 'tag']) {
    if (row[key] != null && typeof row[key] !== 'string') return false;
  }
  if (row.imageIsTest != null && typeof row.imageIsTest !== 'boolean') return false;
  if (typeof row.imageUrl === 'string' && row.imageUrl && !row.imageUrl.startsWith('/')) {
    try { if (!['http:', 'https:'].includes(new URL(row.imageUrl).protocol)) return false; } catch { return false; }
  }
  return true;
}

export default function ChinaMemberHomePage() {
  const { user } = useAuth();
  const { items } = useCart();
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [productsReload, setProductsReload] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [activeStores, setActiveStores] = useState<StoreApplication[]>([]);
  const [storesLoaded, setStoresLoaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    setProductsLoading(true);
    setProductsError('');
    fetch('/api/products', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data) || !data.every(isHomeProductRow)) throw new Error('Invalid public catalog');
        if (!disposed) setProducts(data);
      })
      .catch(() => {
        if (!disposed) { setProducts([]); setProductsError('商品暂时无法读取，请重试'); }
      })
      .finally(() => {
        if (!disposed) setProductsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [productsReload]);

  useEffect(() => {
    if (!user) {
      setWorkspace(null);
      setWorkspaceLoaded(true);
      setActiveStores([]);
      setStoresLoaded(true);
      return;
    }

    let disposed = false;
    setWorkspaceLoaded(false);
    setStoresLoaded(false);

    fetch('/api/cn/workspaces/member?range=30d', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (!disposed) setWorkspace(data || null);
      })
      .catch(() => {
        if (!disposed) setWorkspace(null);
      })
      .finally(() => {
        if (!disposed) setWorkspaceLoaded(true);
      });

    fetch('/api/cn/store-applications', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        const rows = Array.isArray(data?.applications) ? data.applications : [];
        if (!disposed) setActiveStores(rows.filter((row: StoreApplication) => row.status === 'active'));
      })
      .catch(() => {
        if (!disposed) setActiveStores([]);
      })
      .finally(() => {
        if (!disposed) setStoresLoaded(true);
      });

    return () => {
      disposed = true;
    };
  }, [user]);

  const visibleCategories = useMemo(() => uniqueCategories(products), [products]);
  const healthProducts = useMemo(
    () => filterShopProducts(products, SHOP_GUEST_HEALTH_CATEGORY, '').slice(0, 4) as Product[],
    [products],
  );
  const featuredProducts = useMemo(() => products.slice(0, 4), [products]);
  const latestHealth = workspace?.health?.[0] || null;
  const personalCategory = latestHealth?.category || SHOP_PERSONAL_HEALTH_CATEGORY;
  const personalHref = latestHealth?.recommendationBlocked
    ? '/cn/member#health-records'
    : `/cn/shop?category=${encodeURIComponent(String(personalCategory))}`;

  const homeStats = [
    { label: '可售商品', value: productsLoading ? '读取中' : productsError ? '读取失败' : String(products.length), href: '/cn/shop' },
    { label: '健康分类', value: productsLoading ? '读取中' : productsError ? '读取失败' : String(visibleCategories.length), href: '/cn/shop' },
    { label: '购物车', value: `${items.length} 件`, href: '/cn/cart' },
  ];

  return (
    <main className="min-h-screen bg-[var(--caomi-page)] pb-20 text-stone-950 md:pb-0">
      <header className="sticky top-0 z-40 border-b border-[#dce3d8] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link href="/cn/home" className="flex shrink-0 items-center gap-2 text-xl font-black text-[var(--caomi-forest-900)]">
            <Image src="/images/caomi-logo.png" alt="糙米" width={136} height={122} priority className="h-9 w-9 rounded-lg object-contain" />
            <span className="hidden sm:inline">糙米</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-2 md:flex">
            {navLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-black ${
                    item.href === '/cn/home'
                      ? 'bg-[var(--caomi-forest-900)] text-white'
                      : 'border border-stone-200 bg-white text-stone-700 hover:border-[var(--caomi-leaf-700)]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <Link href="/cn/shop" className="ml-auto hidden items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm font-black text-stone-700 md:inline-flex">
            <Search className="h-4 w-4" />
            搜索商品
          </Link>
          <Link href="/cn/cart" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--caomi-forest-900)] text-white" aria-label="购物车">
            <ShoppingCart className="h-5 w-5" />
            {items.length ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-black">{items.length}</span> : null}
          </Link>
          <div className="hidden md:block">
            <ChinaLogoutButton />
          </div>
        </div>
      </header>
      <CnMasterEntryBar />

      <section className="relative isolate overflow-hidden bg-[var(--caomi-forest-950)] text-white">
        <Image
          src="/images/brand-ai/caomi-quantum-demo.jpg"
          alt="阿富同学设备与门店体验"
          fill
          priority
          className="absolute inset-0 -z-30 h-full w-full object-cover opacity-45"
        />
        <video
          className="absolute inset-0 -z-20 h-full w-full object-cover opacity-30"
          src="/device-showcase.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="阿富同学设备展示"
        />
        <div className="absolute inset-0 -z-10 bg-[var(--caomi-forest-950)]/55" />
        <div className="mx-auto grid min-h-[58svh] max-w-7xl content-center gap-8 px-4 py-10 sm:min-h-[68svh] sm:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-black text-[var(--caomi-gold-100)]">
              <Image src="/images/caomi-logo.png" alt="糙米" width={136} height={122} className="h-5 w-5 rounded object-contain" />
              糙米会员平台
            </div>
            <h1 className="mt-5 text-4xl font-black leading-tight sm:text-5xl lg:text-6xl">从健康商品到附近门店，会员服务集中在这里</h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-8 text-stone-100 sm:text-lg">
              浏览已上架商品、查看个人健康记录带来的推荐提示，并连接阿富同学门店体验流程。平台只呈现当前能进入的会员功能，不生成诊断结论、效果承诺或假预约。
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/cn/experience" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 font-black text-[var(--caomi-forest-950)]">
                <CalendarClock className="h-5 w-5" />
                预约附近门店
              </Link>
              <Link href="/cn/shop" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/10 px-5 py-3 font-black text-white">
                <ShoppingBag className="h-5 w-5" />
                进入健康商城
              </Link>
            </div>
          </div>

          <div className="hidden content-end gap-3 sm:grid lg:justify-self-end">
            {homeStats.map((item) => (
              <Link key={item.label} href={item.href} className="flex min-h-20 w-full items-center justify-between gap-5 border-l-4 border-[var(--caomi-gold-600)] bg-white/10 px-4 py-3 backdrop-blur sm:w-80">
                <div>
                  <div className="text-sm font-bold text-stone-200">{item.label}</div>
                  <div className="mt-1 text-2xl font-black">{item.value}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-[var(--caomi-gold-100)]" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-[#dce3d8] bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--caomi-leaf-50)] px-3 py-1 text-xs font-black text-[var(--caomi-forest-700)]">
              <Sparkles className="h-4 w-4" />
              第一重点内容
            </div>
            <h2 className="mt-4 text-3xl font-black leading-tight text-stone-950 sm:text-4xl">阿富同学，把到店体验、记录与推荐接起来</h2>
            <p className="mt-4 text-sm font-semibold leading-7 text-stone-600 sm:text-base">
              阿富同学是门店使用的健康体验设备与服务流程入口。会员可先进入附近门店预约流程；若 API 或门店资料未能读取，流程会显示登录或尚未指定门店，不会假装预约完成。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/cn/experience" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[var(--caomi-forest-900)] px-5 py-3 font-black text-white">
                <CalendarClock className="h-5 w-5" />
                预约附近门店
              </Link>
              <Link href="/stores/locator" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-5 py-3 font-black text-stone-800">
                <LocateFixed className="h-5 w-5" />
                查看服务网点
              </Link>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-lg border border-stone-200 bg-[var(--caomi-gold-50)] p-5">
              <Store className="h-7 w-7 text-[var(--caomi-gold-800)]" />
              <h3 className="mt-4 text-xl font-black text-stone-950">附近门店</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">
                {user
                  ? storesLoaded
                    ? activeStores.length
                      ? `已读取 ${activeStores.length} 家运营中门店，预约流程会带入可用门店。`
                      : '当前账号没有读取到运营中门店，预约流程会保留尚未指定门店。'
                    : '正在读取门店状态。'
                  : '登录后可读取已开通门店；也可先用网点定位查询附近服务点。'}
              </p>
            </article>
            <article className="rounded-lg border border-stone-200 bg-[var(--caomi-leaf-50)] p-5">
              <ShieldCheck className="h-7 w-7 text-[var(--caomi-forest-700)]" />
              <h3 className="mt-4 text-xl font-black text-stone-950">服务边界说明</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">
                阿富同学相关资料仅用于健康管理记录与商品推荐参考，不作为诊断、治疗建议或效果承诺。
              </p>
            </article>
            <Link href="/cn/member/store-application" className="rounded-lg border border-stone-200 bg-white p-5 transition hover:border-[var(--caomi-leaf-700)] md:col-span-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-black text-stone-950">了解阿富同学门店导览</h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">查看设备、服务流程、客服确认与合作条件说明。</p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-[var(--caomi-forest-700)]" />
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[var(--caomi-page)]">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black text-[var(--caomi-forest-700)]">
                <HeartPulse className="h-4 w-4" />
                动态商品内容
              </div>
              <h2 className="mt-4 text-3xl font-black text-stone-950">健康精选</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-7 text-stone-600">
                这里只显示正式可见、已审核、已上架且可售的商品；没有商品的分类不会出现。
              </p>
            </div>
            <Link href="/cn/shop" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-black text-stone-800">
              全部商品
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {productsLoading ? (
            <div className="mt-6 rounded-lg border border-stone-200 bg-white p-8 text-center font-bold text-stone-500">正在读取可售商品...</div>
          ) : productsError ? (
            <div role="alert" className="mt-6 rounded-lg border border-amber-200 bg-[var(--caomi-gold-50)] p-6 font-bold leading-7 text-[var(--caomi-gold-800)]">
              <p>{productsError}</p>
              <button type="button" aria-label="重新加载商品" onClick={() => setProductsReload(value => value + 1)} className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" />重新加载</button>
            </div>
          ) : healthProducts.length ? (
            <>
              <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
                {visibleCategories.map((category) => (
                  <Link key={category} href={`/cn/shop?category=${encodeURIComponent(category)}`} className="shrink-0 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-black text-stone-700">
                    {category}
                  </Link>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {healthProducts.map((product) => (
                  <article key={product.id} className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                    <Link href={productHref(product)} className="block">
                      <div className="relative aspect-square bg-stone-100">
                        <ShopProductImage src={product.imageUrl} alt={product.name} sizes="(min-width: 1024px) 300px, 50vw" />
                        {product.imageIsTest ? <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[11px] font-bold text-white">图片仅供参考</span> : null}
                      </div>
                      <div className="p-3">
                        <div className="text-xs font-black text-[var(--caomi-forest-700)]">{productShopCategory(product)}</div>
                        <h3 className="mt-2 line-clamp-2 min-h-[44px] font-black leading-6 text-stone-950">{product.name}</h3>
                        <p className="mt-2 line-clamp-2 min-h-[40px] text-xs font-semibold leading-5 text-stone-500">{product.description || '查看商品详情与履约说明。'}</p>
                        <div className="mt-3 text-lg font-black text-red-600">{formatCny(getCnyPrice(product))}</div>
                      </div>
                    </Link>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-lg border border-stone-200 bg-white p-8 text-center">
              <Package className="mx-auto h-11 w-11 text-stone-300" />
              <h3 className="mt-3 text-lg font-black text-stone-950">当前没有可显示的健康精选商品</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-stone-500">商品未上架、未审核、无库存或 API 未返回时，本区块不会写死空分类。</p>
            </div>
          )}
        </div>
      </section>

      <section className="border-y border-[#dce3d8] bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--caomi-gold-50)] px-3 py-1 text-xs font-black text-[var(--caomi-gold-800)]">
              <BadgeCheck className="h-4 w-4" />
              个人化推荐
            </div>
            <h2 className="mt-4 text-3xl font-black text-stone-950">根据会员资料继续下一步</h2>
            <p className="mt-3 text-sm font-semibold leading-7 text-stone-600">
              个人化推荐只在会员已有健康记录且未被安全规则阻止时提供入口；资料不足时，引导回真实会员中心或商城。
            </p>
          </div>

          <div className="grid gap-3">
            {user ? (
              <Link href={personalHref} className="rounded-lg border border-stone-200 bg-[var(--caomi-leaf-50)] p-5 transition hover:border-[var(--caomi-leaf-700)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black text-stone-950">
                      {workspaceLoaded
                        ? latestHealth
                          ? latestHealth.recommendationBlocked
                            ? '本次记录不生成商品推荐'
                            : '查看我的健康推荐'
                          : '尚无健康记录'
                        : '正在读取会员资料'}
                    </h3>
                    <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">
                      {workspaceLoaded
                        ? latestHealth
                          ? latestHealth.recommendationBlocked
                            ? latestHealth.advice || '请先咨询专业医疗人员，平台不会生成商品导购。'
                            : `前往 ${String(personalCategory)} 商品列表。`
                          : '可在会员中心查看记录，或从健康商城浏览当前可售商品。'
                        : '会员资料读取完成后再显示可用入口。'}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-[var(--caomi-forest-700)]" />
                </div>
              </Link>
            ) : (
              <Link href="/cn/login?next=%2Fcn%2Fhome" className="rounded-lg border border-stone-200 bg-[var(--caomi-leaf-50)] p-5 transition hover:border-[var(--caomi-leaf-700)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black text-stone-950">登录后查看个人化推荐</h3>
                    <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">未登录状态不会读取或展示个人健康记录。</p>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-[var(--caomi-forest-700)]" />
                </div>
              </Link>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/cn/shop?category=%E5%81%A5%E5%BA%B7%E4%BC%98%E9%80%89" className="rounded-lg border border-stone-200 bg-white p-5 transition hover:border-[var(--caomi-leaf-700)]">
                <ShoppingBag className="h-6 w-6 text-[var(--caomi-forest-700)]" />
                <h3 className="mt-3 font-black text-stone-950">健康优选</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-stone-500">进入现有健康优选分类；没有商品时商城会显示空状态。</p>
              </Link>
              <Link href="/cn/member#store-applications" className="rounded-lg border border-stone-200 bg-white p-5 transition hover:border-[var(--caomi-leaf-700)]">
                <Bell className="h-6 w-6 text-[var(--caomi-gold-800)]" />
                <h3 className="mt-3 font-black text-stone-950">门店与通知</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-stone-500">查看参与门店、申请进度与站内提醒。</p>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {featuredProducts.length ? (
        <section className="bg-[var(--caomi-page)]">
          <div className="mx-auto max-w-7xl px-4 py-10">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-stone-950">热门 / 新品</h2>
                <p className="mt-2 text-sm font-semibold text-stone-500">来自同一组可售商品资料，点击进入商品详情。</p>
              </div>
              <Link href="/cn/shop" className="text-sm font-black text-[var(--caomi-forest-700)]">查看商城</Link>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {featuredProducts.map((product) => (
                <Link key={product.id} href={productHref(product)} className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-[var(--caomi-leaf-700)]">
                  <div className="flex items-center gap-3">
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                      <ShopProductImage src={product.imageUrl} alt={product.name} sizes="96px" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-black text-stone-950">{product.name}</div>
                      <div className="mt-1 text-xs font-bold text-stone-500">{productShopCategory(product)} · {formatCny(getCnyPrice(product))}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <h2 className="text-2xl font-black text-stone-950">会员服务</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {serviceLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="rounded-lg border border-stone-200 bg-white p-5 transition hover:border-[var(--caomi-leaf-700)]">
                  <Icon className="h-6 w-6 text-[var(--caomi-forest-700)]" />
                  <h3 className="mt-3 font-black text-stone-950">{item.title}</h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-stone-500">{item.detail}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <ChinaMobileTabBar active="home" />
    </main>
  );
}
