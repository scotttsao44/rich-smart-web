'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Brain, CheckCircle2, Sparkles, UploadCloud, Zap } from 'lucide-react';
import { emptyProductForm, productToFormValues, type ProductFormValues, validateProductForm } from '@/lib/vendor-product-form-feedback';

type EditableProduct = Record<string, any> & {
  id: number;
  name: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
};

export default function EditVendorProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<EditableProduct | null>(null);
  const [form, setForm] = useState<ProductFormValues>(emptyProductForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Conversational AI Editor state
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentReply, setAgentReply] = useState('');

  useEffect(() => {
    fetch(`/api/vendor/products/${params.id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '读取商品失败');
        setProduct(data.product);
        setForm(productToFormValues(data.product));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  const setField = (key: keyof ProductFormValues, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const runConversationalEdit = async (options?: { presetPrompt?: string; autoPublish?: boolean }) => {
    const promptToUse = options?.presetPrompt !== undefined ? options.presetPrompt : agentPrompt;
    setAgentLoading(true);
    setError('');
    setSuccessMsg('');
    setAgentReply('');
    try {
      const res = await fetch('/api/cn/agent-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'product_edit',
          productId: Number(params.id),
          prompt: promptToUse,
          currentForm: form,
          autoPublish: Boolean(options?.autoPublish),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI 编辑失败');
      if (data.draft) {
        setForm((current) => ({ ...current, ...data.draft }));
        setFieldErrors({});
      }
      setAgentReply(data.agentReply || '✨ AI Agent 已根据您的指令更新商品栏位！');
      if (data.autoPublished && data.product) {
        setProduct(data.product);
        setSuccessMsg('🎉 AI 修改已直接生效并同步至线上商城！');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 编辑失败');
    } finally {
      setAgentLoading(false);
    }
  };

  const uploadProductImage = async (file?: File) => {
    if (!file) return;
    setUploadingImage(true);
    setError('');
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('purpose', 'product');
      const res = await fetch('/api/cn/brand-assets', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '商品图片上传失败');
      setField('imageUrl', data.asset.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '商品图片上传失败');
    } finally {
      setUploadingImage(false);
    }
  };

  const saveProduct = async (autoApprove = true) => {
    setError('');
    setSuccessMsg('');
    const nextErrors = validateProductForm(form);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/vendor/products/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, autoApprove }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '更新失败');
      if (autoApprove) {
        setSuccessMsg(data.message || '🎉 商品修改已立即生效并同步至商城！');
        if (data.product) setProduct(data.product);
      } else {
        router.push('/vendor?resubmitted=1');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await saveProduct(true);
  };

  const retailNum = Number(form.priceCny || 0);
  const supplyNum = Number(form.supplyPriceCny || 0);
  const feeNum = retailNum > 0 ? Math.round(retailNum * 0.006 * 100) / 100 : 0;
  const poolNum = retailNum > supplyNum ? Math.max(0, Math.round((retailNum - supplyNum - feeNum) * 100) / 100) : 0;

  return (
    <main className="min-h-screen bg-[#f5f2ea] px-4 py-8 text-stone-950">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/vendor" className="inline-flex items-center gap-2 font-bold text-stone-600"><ArrowLeft className="h-4 w-4" />返回品牌工作台</Link>
          <Link href="/cn/shop" className="text-sm font-bold text-teal-700 hover:underline">前往商城查看实时效果 →</Link>
        </div>

        <h1 className="mt-5 text-3xl font-black">编辑商品 · AI 对话式极速编辑器</h1>
        {loading ? <div className="mt-6 rounded-lg bg-white p-6">读取中...</div> : null}
        {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{error}</div> : null}
        {successMsg ? <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm font-black text-emerald-900">{successMsg}</div> : null}

        {product?.rejectionReason ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900">
            退回原因：{product.rejectionReason}
          </div>
        ) : null}

        {!loading && product ? (
          <>
            {/* Conversational AI Editor Box */}
            <section className="mt-6 rounded-2xl border-2 border-teal-600 bg-gradient-to-br from-teal-950 via-stone-900 to-teal-900 p-6 text-white shadow-lg">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-stone-950">
                  <Brain className="h-6 w-6" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black">阿富 AI 对话式商品编辑器</h2>
                    <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-black text-amber-300">一句话改价 / 改文案 / 改库存 / 改分润</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-teal-100/85">
                    不用在十几个框里慢慢找！直接告诉 AI 您想怎么改，可预览修改或一键直接同步到商城。
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={agentLoading}
                  onClick={() => {
                    const p = '升级为「富智慧频率密码健康仪（三段能量 AI 变频系统）」，突出国家外观专利 ZL 2025 3 0195027.X 与上照射口频率+中段700uT旋磁+下方8-14微米体感光波';
                    setAgentPrompt(p);
                    void runConversationalEdit({ presetPrompt: p, autoPublish: false });
                  }}
                  className="rounded-full border border-amber-300/60 bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-200 hover:bg-amber-400/25"
                >
                  ⚡ 强化三段能量与专利介绍
                </button>
                <button
                  type="button"
                  disabled={agentLoading}
                  onClick={() => {
                    const p = '库存改成 200，优化发货说明为：品牌官方仓 24 小时内顺丰专线包邮发出，支持门店体验与 1 对 1 远程指导';
                    setAgentPrompt(p);
                    void runConversationalEdit({ presetPrompt: p, autoPublish: false });
                  }}
                  className="rounded-full border border-teal-400/40 bg-white/10 px-3 py-1 text-xs font-bold text-teal-100 hover:bg-white/20"
                >
                  📦 调整库存与顺丰包邮履约说明
                </button>
              </div>

              <div className="mt-3">
                <textarea
                  rows={2}
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  placeholder="告诉 AI 您想怎么改（例如：把售价改成 39800，结算价 23800；或者：补充一段居家温热调理的卖点说明）..."
                  className="w-full rounded-xl border border-teal-500/40 bg-black/30 p-3 text-sm font-semibold text-white placeholder-teal-200/50 outline-none focus:border-amber-400"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={agentLoading}
                  onClick={() => void runConversationalEdit({ autoPublish: false })}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-stone-950 shadow hover:bg-amber-300 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {agentLoading ? 'AI 修改中...' : '✨ AI 修改下方表单预览'}
                </button>
                <button
                  type="button"
                  disabled={agentLoading}
                  onClick={() => void runConversationalEdit({ autoPublish: true })}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Zap className="h-4 w-4" />
                  {agentLoading ? '同步商城中...' : '🚀 AI 一键修改并立即同步至商城'}
                </button>
              </div>

              {agentReply ? (
                <div className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-950/70 p-3 text-xs font-bold text-emerald-200">
                  {agentReply}
                </div>
              ) : null}
            </section>

            {/* Live Commission Preview */}
            {retailNum > 0 ? (
              <section className="mt-4 grid gap-3 rounded-xl border border-teal-200 bg-teal-50/80 p-4 text-sm text-teal-950 sm:grid-cols-4">
                <div>
                  <div className="text-xs font-bold text-teal-700">零售价 / 品牌结算价</div>
                  <div className="mt-0.5 font-black">¥{retailNum.toLocaleString()} / ¥{supplyNum.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-teal-700">单件可分配推广池</div>
                  <div className="mt-0.5 font-black text-emerald-800">¥{poolNum.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-teal-700">直推 {form.directRate}% / 间推 {form.upperRate}%</div>
                  <div className="mt-0.5 font-black">¥{Math.round(poolNum * Number(form.directRate || 0) / 100).toLocaleString()} / ¥{Math.round(poolNum * Number(form.upperRate || 0) / 100).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-teal-700">近30天贡献池 ({form.activeRate}%)</div>
                  <div className="mt-0.5 font-black text-amber-800">¥{Math.round(poolNum * Number(form.activeRate || 0) / 100).toLocaleString()}</div>
                </div>
              </section>
            ) : null}

            <form onSubmit={submit} className="mt-6 grid gap-4 rounded-xl border border-stone-200 bg-white p-6 md:grid-cols-2">
              <div><label className="label">商品名称</label><input className="input-field" value={form.name} onChange={(e) => setField('name', e.target.value)} />{fieldErrors.name ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.name}</p> : null}</div>
              <div><label className="label">分类</label><input className="input-field" value={form.category} onChange={(e) => setField('category', e.target.value)} />{fieldErrors.category ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.category}</p> : null}</div>
              <div><label className="label">SKU（选填）</label><input className="input-field" value={form.sku} onChange={(e) => setField('sku', e.target.value)} /></div>
              <div><label className="label">售价（人民币）</label><input type="number" className="input-field" value={form.priceCny} onChange={(e) => setField('priceCny', e.target.value)} />{fieldErrors.priceCny ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.priceCny}</p> : null}</div>
              <div><label className="label">划线价 / 原价（选填）</label><input type="number" className="input-field" value={form.compareAtPrice} onChange={(e) => setField('compareAtPrice', e.target.value)} />{fieldErrors.compareAtPrice ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.compareAtPrice}</p> : null}</div>
              <div><label className="label">品牌供货结算价（人民币）</label><input type="number" className="input-field" value={form.supplyPriceCny} onChange={(e) => setField('supplyPriceCny', e.target.value)} />{fieldErrors.supplyPriceCny ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.supplyPriceCny}</p> : null}</div>
              <div><label className="label">库存数量</label><input type="number" className="input-field" value={form.stockQuantity} onChange={(e) => setField('stockQuantity', e.target.value)} />{fieldErrors.stockQuantity ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.stockQuantity}</p> : null}</div>
              <div>
                <label className="label">商品主图路径或图片网址</label>
                <div className="flex gap-2">
                  <input className="input-field flex-1" value={form.imageUrl} onChange={(e) => setField('imageUrl', e.target.value)} />
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-teal-700 bg-teal-50 px-3 py-2 text-xs font-black text-teal-800 hover:bg-teal-100">
                    <UploadCloud className="h-4 w-4" />{uploadingImage ? '上传中...' : '换图'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingImage} onChange={(e) => { void uploadProductImage(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </div>
                {fieldErrors.imageUrl ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.imageUrl}</p> : null}
              </div>
              <div className="md:col-span-2"><label className="label">商品介绍 / 核心卖点（不可含医疗疗效宣称）</label><textarea className="input-field" rows={6} value={form.description} onChange={(e) => setField('description', e.target.value)} />{fieldErrors.description ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.description}</p> : null}</div>
              <div className="md:col-span-2"><label className="label">多规格选项（每行一组，如 规格: 标准装, 家庭装）</label><textarea className="input-field" rows={2} value={form.variantText} onChange={(e) => setField('variantText', e.target.value)} /></div>
              <div><label className="label">配送方式</label><input className="input-field" value={form.shippingMethodsText} onChange={(e) => setField('shippingMethodsText', e.target.value)} /></div>
              <div><label className="label">出货与时效说明</label><input className="input-field" value={form.fulfillmentInfo} onChange={(e) => setField('fulfillmentInfo', e.target.value)} />{fieldErrors.fulfillmentInfo ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.fulfillmentInfo}</p> : null}</div>
              <div className="grid grid-cols-3 gap-2 md:col-span-2">
                <div><label className="label">直推比例%</label><input type="number" className="input-field" value={form.directRate} onChange={(e) => setField('directRate', e.target.value)} /></div>
                <div><label className="label">上层比例%</label><input type="number" className="input-field" value={form.upperRate} onChange={(e) => setField('upperRate', e.target.value)} /></div>
                <div><label className="label">贡献池比例%</label><input type="number" className="input-field" value={form.activeRate} onChange={(e) => setField('activeRate', e.target.value)} /></div>
                {fieldErrors.directRate ? <p className="col-span-3 text-xs font-bold text-red-600">{fieldErrors.directRate}</p> : null}
              </div>
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-3 font-black text-white shadow hover:bg-emerald-600 disabled:opacity-50">
                  <CheckCircle2 className="h-4 w-4" />
                  {submitting ? '保存中...' : '🚀 保存修改并立即同步商城'}
                </button>
                <button type="button" disabled={submitting} onClick={() => void saveProduct(false)} className="rounded-lg border border-stone-300 bg-stone-100 px-5 py-3 font-bold text-stone-700 hover:bg-stone-200 disabled:opacity-50">
                  提交人工复核
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
