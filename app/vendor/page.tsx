'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Brain, CheckCircle2, Clock3, Edit3, PackagePlus, Sparkles, Store, XCircle, Zap } from 'lucide-react';
import ProductLeadList from '@/components/ProductLeadList';
import { useAuth } from '@/app/providers';

type VendorProduct = {
  id: number;
  name: string;
  brandName: string;
  category: string;
  priceCny: number;
  supplyPriceCny: number;
  stockQuantity: number;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  salesStatus: 'active' | 'paused';
  rejectionReason: string;
  editUrl: string | null;
  listingType?: string | null;
};

type BrandSummary = {
  id: number;
  brandName: string;
  companyName: string;
  category: string;
  slug?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote?: string;
};

const statusMap = {
  pending: { label: '待审核', icon: Clock3, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  approved: { label: '已上架商城', icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  rejected: { label: '已退回', icon: XCircle, className: 'border-red-200 bg-red-50 text-red-900' },
};

export default function VendorDashboardPage() {
  const [brand, setBrand] = useState<BrandSummary | null>(null);
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickPublishing, setQuickPublishing] = useState(false);
  const [application, setApplication] = useState<{ status?: string; brandName?: string } | null>(null);
  const { user } = useAuth();
  const [shareOrigin, setShareOrigin] = useState('https://rich-smart.com.cn');
  const [copiedShare, setCopiedShare] = useState('');
  useEffect(() => { setShareOrigin(window.location.origin); }, []);
  // 品牌方转发链接一律带「自己」的会员推荐码（现有 ref 参数），打开者归属记到品牌方本人
  const myRefCode = String(user?.referralCode || '').trim();
  const withMyRef = (path: string) => `${shareOrigin}${path}${myRefCode ? `${path.includes('?') ? '&' : '?'}ref=${encodeURIComponent(myRefCode)}` : ''}`;
  const copyShare = async (key: string, url: string) => {
    try { await navigator.clipboard.writeText(url); setCopiedShare(key); setTimeout(() => setCopiedShare(''), 2000); } catch { /* ignore */ }
  };

  const loadData = () => {
    setLoading(true);
    fetch('/api/vendor/products')
      .then(async (res) => {
        const data = await res.json();
        if (res.status === 401) {
          window.location.href = '/cn/login?next=/vendor';
          return;
        }
        if (!res.ok) throw new Error(data.error || '读取品牌工作台失败');
        setBrand(data.brand || null);
        setProducts(data.products || []);
        setApplication(Array.isArray(data.applications) && data.applications[0] ? data.applications[0] : null);
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('submitted') === 'approved') setMessage('商品已上架商城。');
    else if (params.get('submitted') === '1') setMessage('商品已提交平台审核。');
    if (params.get('resubmitted') === '1') setMessage('商品资料已更新。');
    loadData();
  }, []);

  const quickPublishProduct = async (preset?: string) => {
    const promptToUse = preset !== undefined ? preset : quickPrompt;
    setQuickPublishing(true);
    setMessage('');
    try {
      const res = await fetch('/api/cn/agent-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'product_generate',
          prompt: promptToUse,
          autoPublish: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI 生成失败');
      setMessage(data.agentReply || '商品已生成并提交平台审核。');
      setQuickPrompt('');
      loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'AI 生成失败');
    } finally {
      setQuickPublishing(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f2ea] px-4 py-8 text-stone-950">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/cn/shop" className="inline-flex items-center gap-2 font-bold text-stone-600"><ArrowLeft className="h-4 w-4" />返回商城</Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/vendor/page-builder" className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 bg-white px-4 py-2 text-sm font-black text-teal-800 hover:bg-teal-50">
              <Sparkles className="h-4 w-4" />AI 品牌馆设计器
            </Link>
            <Link href="/cn/brand/demo" className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-700 hover:bg-stone-50">
              分润与订单中心
            </Link>
            <Link href="/vendor/products/new" className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-black text-white shadow hover:bg-teal-800">
              <PackagePlus className="h-4 w-4" />新增商品
            </Link>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Store className="h-9 w-9 text-teal-700" />
          <div>
            <h1 className="text-3xl font-black">品牌工作台</h1>
            <p className="text-sm font-semibold text-stone-600">管理品牌资料与商品；商品提交后由平台审核，通过后上架商城。</p>
          </div>
        </div>

        {message ? <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-black text-emerald-950">{message}</div> : null}

        {/* AI Agent Express Bar right inside Vendor Dashboard */}
        <section className="mt-6 rounded-2xl border-2 border-teal-600 bg-gradient-to-br from-teal-950 via-stone-900 to-teal-900 p-5 text-white shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-stone-950"><Brain className="h-5 w-5" /></span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black">AI 商品助手 · 一句话生成商品</h2>
                </div>
                <p className="text-xs font-semibold text-teal-100/80">说出品名、售价、结算价与卖点，AI 生成商品资料并提交平台审核。未提供的内容请到编辑页核对补充。</p>
              </div>
            </div>
            <Link href="/vendor/products/new" className="rounded-xl border border-white/30 bg-white/10 px-3.5 py-2 text-xs font-black text-white hover:bg-white/20">
              打开完整商品表单 →
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              placeholder="例如：「某某健康仪」，售价 3980，结算价 2380，主要卖点……"
              className="flex-1 rounded-xl border border-teal-500/40 bg-black/30 px-4 py-2.5 text-sm font-semibold text-white placeholder-teal-200/50 outline-none focus:border-amber-400"
            />
            <button
              type="button"
              disabled={quickPublishing}
              onClick={() => void quickPublishProduct()}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-black text-stone-950 shadow hover:bg-amber-300 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" />
              {quickPublishing ? 'AI 生成中...' : '生成并提交审核'}
            </button>
          </div>
        </section>

        {loading ? <div className="mt-6 rounded-lg bg-white p-6">读取中...</div> : null}

        {!loading && !brand ? (
          <section className="mt-6 rounded-lg border border-stone-200 bg-white p-6">
            {application?.status === 'pending' ? (
              <>
                <h2 className="text-xl font-black">品牌申请审核中</h2>
                <p className="mt-2 text-sm text-stone-600">「{application.brandName || '品牌'}」已提交，平台审核通过后即可提交商品。审核期间可先准备商品图片与资料。</p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-black">尚未开通品牌入驻</h2>
                <p className="mt-2 text-sm text-stone-600">提交品牌入驻申请（上传营业执照等资料），平台审核通过后开通品牌工作台。</p>
                <Link href="/cn/brand/apply" className="mt-4 inline-flex rounded-lg bg-teal-700 px-4 py-2 font-bold text-white">前往品牌入驻</Link>
              </>
            )}
          </section>
        ) : null}

        {brand ? (
          <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-stone-500">当前入驻品牌</div>
                <h2 className="text-2xl font-black">{String(brand.brandName || '').replace(/^[“”"'「」『』\s]+|[“”"'「」『』\s]+$/g, '').trim()}</h2>
                <p className="text-sm font-semibold text-stone-600">{String(brand.companyName || '').replace(/^[“”"'「」『』\s]+|[“”"'「」『』\s]+$/g, '').trim()} · {brand.category}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-900">
                  {brand.status === 'approved' ? '✓ 已核准开通' : brand.status === 'rejected' ? '已退回' : '待审核'}
                </span>
                <Link href="/cn/brand/entity" className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-sm font-black text-stone-700 hover:bg-stone-50">
                  变更公司主体
                </Link>
                <Link href={`/cn/brands/${encodeURIComponent(String(brand.slug || '').trim() || String(brand.id))}`} className="rounded-lg border border-teal-700 bg-teal-50 px-3 py-1 text-sm font-black text-teal-800 hover:bg-teal-100">
                  查看品牌馆前台 →
                </Link>
              </div>
            </div>
            {brand.reviewNote ? <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm"><strong>平台备注：</strong>{brand.reviewNote}</p> : null}
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <div className="font-black text-emerald-900">我的品牌转发链接{myRefCode ? `（带我的推荐码 ${myRefCode}）` : ''}</div>
              {myRefCode ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-white px-2 py-1 text-xs text-stone-800">{withMyRef(`/cn/brands/${encodeURIComponent(String(brand.slug || '').trim() || String(brand.id))}`)}</code>
                  <button type="button" onClick={() => void copyShare('brand', withMyRef(`/cn/brands/${encodeURIComponent(String(brand.slug || '').trim() || String(brand.id))}`))} className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-black text-white">{copiedShare === 'brand' ? '已复制' : '复制链接'}</button>
                </div>
              ) : (
                <p className="mt-1 text-stone-700">当前账号尚未开通推荐码，请到 <Link href="/cn/member/share" className="font-black text-teal-800 underline">推广工作台</Link> 查看。</p>
              )}
            </div>
          </section>
        ) : null}

        <section className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black">品牌商品列表（共 {products.length} 款）</h2>
            <Link href="/vendor/products/new" className="text-sm font-black text-teal-700 hover:underline">+ 新增商品</Link>
          </div>
          {products.map((product) => {
            const status = statusMap[product.reviewStatus];
            const Icon = status.icon;
            const editHref = product.editUrl || `/vendor/products/${product.id}/edit`;
            return (
              <div key={product.id} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black">{product.name}</h3>
                    {product.listingType === 'shared_device' ? (
                      <p className="mt-1 text-sm font-semibold text-stone-600">分类：{product.category} · <span className="font-black text-teal-800">共享设备 · 投放合作</span></p>
                    ) : (
                    <p className="mt-1 text-sm font-semibold text-stone-600">
                      分类：{product.category} · 零售价：<span className="font-black text-stone-950">¥{product.priceCny.toLocaleString()}</span> · 品牌结算价：<span className="font-black text-teal-800">¥{product.supplyPriceCny.toLocaleString()}</span> · 库存：{product.stockQuantity}
                    </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-black ${status.className}`}>
                      <Icon className="h-4 w-4" />{status.label}
                    </span>
                    {myRefCode && product.reviewStatus === 'approved' ? (
                      <button type="button" onClick={() => void copyShare(`p${product.id}`, withMyRef(`/cn/shop/${product.id}`))} className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-black text-emerald-800">
                        {copiedShare === `p${product.id}` ? '已复制' : '复制转发链接'}
                      </button>
                    ) : null}
                    <Link
                      href={editHref}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-black text-white shadow-sm hover:bg-teal-800"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      编辑
                    </Link>
                  </div>
                </div>
                {product.rejectionReason ? (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <strong>退回原因：</strong>{product.rejectionReason}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!loading && products.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm font-semibold text-stone-600">
              尚未建立商品，点击「新增商品」填写资料并提交平台审核。
            </div>
          ) : null}
        </section>

        {brand ? <ProductLeadList scope="brand" title="投放合作留资" /> : null}
      </div>
    </main>
  );
}
