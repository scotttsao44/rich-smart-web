'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Brain, CheckCircle2, Sparkles, UploadCloud } from 'lucide-react';
import { emptyProductForm, isSharedDeviceListing, productToFormValues, type ProductFormValues, validateProductForm } from '@/lib/vendor-product-form-feedback';

type EditableProduct = Record<string, any> & {
  id: number;
  name: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
};

export default function EditVendorProductPage() {
  const params = useParams<{ id: string }>();
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
        if (!res.ok) throw new Error(data.message || data.error || '读取商品失败');
        setProduct(data.product);
        // 若有待审核的修改，表单显示修改后的内容（线上仍为原版本）
        const revisionFields = data.product?.pendingRevision?.fields;
        setForm(productToFormValues(revisionFields ? { ...data.product, ...revisionFields } : data.product));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  const setField = (key: keyof ProductFormValues, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const runConversationalEdit = async () => {
    const promptToUse = agentPrompt;
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
          autoPublish: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI 编辑失败');
      if (data.draft) {
        // AI 只改表单内容，不改商品类型（由用户自行切换）
        const { listingType: _ignoredType, ...draftFields } = data.draft as Record<string, unknown>;
        setForm((current) => ({ ...current, ...(draftFields as Partial<ProductFormValues>) }));
        setFieldErrors({});
      }
      setAgentReply(data.agentReply || '已按指令更新下方表单，请核对后点「保存修改」。');
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

  const shared = isSharedDeviceListing(form.listingType);

  const saveProduct = async () => {
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
        body: JSON.stringify(shared ? { ...form, listingType: 'shared_device' } : { ...form, listingType: 'retail', cooperationNote: '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || '更新失败');
      setSuccessMsg(data.message || '修改已保存。');
      if (data.product) setProduct(data.product);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await saveProduct();
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
          <Link href="/cn/shop" className="text-sm font-bold text-teal-700 hover:underline">前往商城 →</Link>
        </div>

        <h1 className="mt-5 text-2xl font-black leading-tight md:text-3xl">编辑商品</h1>
        <p className="mt-2 text-sm font-semibold text-stone-500">修改提交后由平台审核；审核通过前，商城继续显示当前上架版本。</p>
        {loading ? <div className="mt-6 rounded-lg bg-white p-6">读取中...</div> : null}
        {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{error}</div> : null}
        {successMsg ? <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm font-black text-emerald-900">{successMsg}</div> : null}

        {product?.pendingRevision ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            您的修改正在等待平台审核（提交于 {new Date(product.pendingRevision.submittedAt).toLocaleString('zh-CN', { hour12: false })}）。审核通过前，商城继续显示当前上架版本；下方表单为您提交的修改内容。
          </div>
        ) : product?.lastRevisionReview?.decision === 'rejected' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900">
            上次修改未通过审核：{product.lastRevisionReview.note}（商城仍为原版本）
          </div>
        ) : null}

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
                    <h2 className="text-xl font-black">AI 修改助手</h2>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-teal-100/85">
                    告诉 AI 想怎么改，AI 更新下方表单，核对后点「保存修改」。
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <textarea
                  rows={2}
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  placeholder="例如：把售价改成 3980，结算价 2380；或：补充一段使用场景说明"
                  className="w-full rounded-xl border border-teal-500/40 bg-black/30 p-3 text-sm font-semibold text-white placeholder-teal-200/50 outline-none focus:border-amber-400"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={agentLoading}
                  onClick={() => void runConversationalEdit()}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-stone-950 shadow hover:bg-amber-300 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {agentLoading ? 'AI 修改中...' : 'AI 修改表单'}
                </button>
              </div>

              {agentReply ? (
                <div className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-950/70 p-3 text-xs font-bold text-emerald-200">
                  {agentReply}
                </div>
              ) : null}
            </section>

            {/* Live Commission Preview */}
            {/* 商品类型 */}
            <div role="radiogroup" aria-label="商品类型" className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-stone-200 bg-white p-1.5 md:max-w-md">
              {([
                { value: 'retail', title: '零售商品', sub: '标价销售 · 下单发货' },
                { value: 'shared_device', title: '共享设备', sub: '投放合作 · 不标价' },
              ] as const).map((option) => {
                const active = (option.value === 'shared_device') === shared;
                return (
                  <button key={option.value} type="button" role="radio" aria-checked={active} onClick={() => setForm((current) => ({ ...current, listingType: option.value }))} className={`rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-teal-700 text-white shadow-sm' : 'text-stone-700 hover:bg-stone-50'}`}>
                    <span className="block text-sm font-black">{option.title}</span>
                    <span className={`mt-0.5 block text-[11px] font-bold ${active ? 'text-teal-50' : 'text-stone-500'}`}>{option.sub}</span>
                  </button>
                );
              })}
            </div>

            {!shared && retailNum > 0 ? (
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
              {!shared ? (
                <>
              <div><label className="label">售价（人民币）</label><input type="number" className="input-field" value={form.priceCny} onChange={(e) => setField('priceCny', e.target.value)} />{fieldErrors.priceCny ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.priceCny}</p> : null}</div>
              <div><label className="label">划线价 / 原价（选填）</label><input type="number" className="input-field" value={form.compareAtPrice} onChange={(e) => setField('compareAtPrice', e.target.value)} />{fieldErrors.compareAtPrice ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.compareAtPrice}</p> : null}</div>
              <div><label className="label">品牌供货结算价（人民币）</label><input type="number" className="input-field" value={form.supplyPriceCny} onChange={(e) => setField('supplyPriceCny', e.target.value)} />{fieldErrors.supplyPriceCny ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.supplyPriceCny}</p> : null}</div>
              <div><label className="label">库存数量</label><input type="number" className="input-field" value={form.stockQuantity} onChange={(e) => setField('stockQuantity', e.target.value)} />{fieldErrors.stockQuantity ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.stockQuantity}</p> : null}</div>
                </>
              ) : null}
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
              {shared ? (
                <div className="md:col-span-2"><label className="label">合作方式说明（选填）</label><textarea className="input-field" rows={3} value={form.cooperationNote} onChange={(e) => setField('cooperationNote', e.target.value)} placeholder="例如：门店免费投放、按次分成，具体条件洽谈" /></div>
              ) : (
                <>
                  <div><label className="label">配送方式</label><input className="input-field" value={form.shippingMethodsText} onChange={(e) => setField('shippingMethodsText', e.target.value)} /></div>
                  <div><label className="label">出货与时效说明</label><input className="input-field" value={form.fulfillmentInfo} onChange={(e) => setField('fulfillmentInfo', e.target.value)} />{fieldErrors.fulfillmentInfo ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.fulfillmentInfo}</p> : null}</div>
                </>
              )}
              <div className="grid grid-cols-3 gap-2 md:col-span-2">
                <div><label className="label">直推比例%</label><input type="number" className="input-field" value={form.directRate} onChange={(e) => setField('directRate', e.target.value)} /></div>
                <div><label className="label">上层比例%</label><input type="number" className="input-field" value={form.upperRate} onChange={(e) => setField('upperRate', e.target.value)} /></div>
                <div><label className="label">贡献池比例%</label><input type="number" className="input-field" value={form.activeRate} onChange={(e) => setField('activeRate', e.target.value)} /></div>
                {fieldErrors.directRate ? <p className="col-span-3 text-xs font-bold text-red-600">{fieldErrors.directRate}</p> : null}
              </div>
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-3 font-black text-white shadow hover:bg-emerald-600 disabled:opacity-50">
                  <CheckCircle2 className="h-4 w-4" />
                  {submitting ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
