'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Brain, CheckCircle2, FileText, Save, Sparkles, UploadCloud, Zap } from 'lucide-react';
import {
  emptyProductForm,
  productFieldLabels,
  productPdfCandidate,
  productPdfError,
  type ProductFormValues,
  validateProductForm,
} from '@/lib/vendor-product-form-feedback';

const PRODUCT_DRAFT_STORAGE_KEY = 'richsmart_cn_vendor_new_product_draft';

export default function NewVendorProductPage() {
  const router = useRouter();
  const [form, setForm] = useState<ProductFormValues>(emptyProductForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});
  const [error, setError] = useState('');
  const [draftSavedNotice, setDraftSavedNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // PDF Draft state
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfNotice, setPdfNotice] = useState('');
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [pdfError, setPdfError] = useState('');

  // AI Agent Brain state
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentReply, setAgentReply] = useState('');
  const [publishedProductId, setPublishedProductId] = useState<number | null>(null);

  const fieldRefs = useRef<Partial<Record<keyof ProductFormValues, HTMLElement | null>>>({});
  const errorBannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          setForm((current) => ({ ...current, ...parsed }));
        }
      }
    } catch {
      // ignore invalid local storage
    }
  }, []);

  const setFieldRef = (key: keyof ProductFormValues) => (el: HTMLElement | null) => {
    fieldRefs.current[key] = el;
  };

  const setField = (key: keyof ProductFormValues, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDraftSavedNotice('');
  };

  const saveDraft = () => {
    try {
      window.localStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify(form));
      setDraftSavedNotice('✅ 商品草稿已保存至本地，可随时继续编辑。');
    } catch {
      setError('浏览器无法保存本地草稿，请直接填写并提交。');
    }
  };

  const handlePdfUpload = async (file?: File) => {
    if (!file) return;
    setUploadingPdf(true);
    setPdfError('');
    setPdfNotice('');
    setPdfWarnings([]);
    setError('');
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/cn/product-draft-from-pdf', {
        method: 'POST',
        body,
      });
      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const msg = productPdfError(data, res.status);
        setPdfError(msg);
        setError(`PDF 草稿读取失败：${msg}`);
        return;
      }
      const candidate = productPdfCandidate(data?.draft || data);
      setForm((current) => ({ ...current, ...candidate }));
      setFieldErrors({});
      setPdfNotice(data?.notice || `✅ 已从「${file.name}」成功提取商品草稿并填入下方表单，请逐项核对后提交审核。`);
      if (Array.isArray(data?.warnings)) {
        setPdfWarnings(data.warnings.map((w: unknown) => String(w)));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF 草稿读取失败，请确认文件未损坏且小于 25MB，或使用 AI 一句话生成。';
      setPdfError(msg);
      setError(`PDF 草稿读取失败：${msg}`);
    } finally {
      setUploadingPdf(false);
    }
  };

  const runProductAgent = async (options?: { presetPrompt?: string; autoPublish?: boolean }) => {
    const promptToUse = options?.presetPrompt !== undefined ? options.presetPrompt : agentPrompt;
    setAgentLoading(true);
    setError('');
    setPdfError('');
    setAgentReply('');
    try {
      const res = await fetch('/api/cn/agent-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'product_generate',
          prompt: promptToUse,
          currentForm: form,
          autoPublish: Boolean(options?.autoPublish),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI Agent 生成失败');
      if (data.draft) {
        setForm((current) => ({ ...current, ...data.draft }));
        setFieldErrors({});
      }
      setAgentReply(data.agentReply || '✨ AI Agent 已完成商品全栏位填充！');
      if (data.autoPublished && data.product?.id) {
        setPublishedProductId(Number(data.product.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI Agent 生成失败');
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

  const focusFirstFieldError = (nextErrors: Partial<Record<keyof ProductFormValues, string>>) => {
    const fieldOrder: Array<keyof ProductFormValues> = [
      'name',
      'category',
      'priceCny',
      'compareAtPrice',
      'supplyPriceCny',
      'stockQuantity',
      'imageUrl',
      'description',
      'fulfillmentInfo',
      'directRate',
      'upperRate',
      'activeRate',
    ];
    const firstKey = fieldOrder.find((key) => Boolean(nextErrors[key]));
    if (firstKey && fieldRefs.current[firstKey]) {
      const el = fieldRefs.current[firstKey];
      el?.focus();
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (errorBannerRef.current) {
      errorBannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const submitWithMode = async (autoApprove: boolean) => {
    setError('');
    setDraftSavedNotice('');
    const nextErrors = validateProductForm(form);
    setFieldErrors(nextErrors);
    const errorKeys = Object.keys(nextErrors) as Array<keyof ProductFormValues>;
    if (errorKeys.length > 0) {
      const missingLabels = errorKeys.map(
        (key) => productFieldLabels[key as keyof typeof productFieldLabels] || key
      );
      setError(`请完善以下必填项后再提交：${missingLabels.join('、')}`);
      setTimeout(() => focusFirstFieldError(nextErrors), 30);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/vendor/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, autoApprove }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');
      try {
        window.localStorage.removeItem(PRODUCT_DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }
      router.push(autoApprove ? '/vendor?submitted=approved' : '/vendor?submitted=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitWithMode(false);
  };

  // Live profit & split preview
  const retailNum = Number(form.priceCny || 0);
  const supplyNum = Number(form.supplyPriceCny || 0);
  const feeNum = retailNum > 0 ? Math.round(retailNum * 0.006 * 100) / 100 : 0;
  const poolNum = retailNum > supplyNum ? Math.max(0, Math.round((retailNum - supplyNum - feeNum) * 100) / 100) : 0;

  return (
    <main className="min-h-screen bg-[#f5f2ea] px-4 py-8 text-stone-950">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/vendor" className="inline-flex items-center gap-2 font-bold text-stone-600"><ArrowLeft className="h-4 w-4" />返回品牌工作台</Link>
          <div className="flex flex-wrap gap-3 text-sm font-bold">
            <Link href="/vendor/products/bulk" className="text-stone-700 hover:underline">批量 CSV 导入</Link>
            <Link href="/cn/shop" className="text-teal-700 hover:underline">前往商城查看已上架商品 →</Link>
          </div>
        </div>

        <h1 className="mt-5 text-3xl font-black">新增商品 · AI Agent 极速上架台</h1>
        <p className="mt-2 text-sm font-semibold text-stone-600">支持「一句话 / 粘贴产品介绍全自动填单」、「选择 PDF 宣传册生成草稿」与「对话式 AI 改价改卖点」。</p>

        {/* AI Agent Brain Card */}
        <section className="mt-6 rounded-2xl border-2 border-teal-600 bg-gradient-to-br from-teal-950 via-stone-900 to-teal-900 p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-stone-950">
                <Brain className="h-6 w-6" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black">阿富 AI 商品 Agent 大脑（一句话生商品 + PDF 智能识别）</h2>
                  <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-black text-amber-300">14 项栏位全自动 · 免手填</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-teal-100/85">
                  直接粘贴产品微信文案、上传产品手册 PDF，或跟 Agent 说一句话（如：「上架富智慧频率密码健康仪，售价39800，供货价23800」），AI 自动填好全部栏位！
                </p>
              </div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-amber-300/60 bg-white/10 px-4 py-2 text-xs font-black text-amber-200 hover:bg-white/20">
              <FileText className="h-4 w-4" />
              {uploadingPdf ? '正在识别 PDF...' : '📄 选择 PDF 生成草稿'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={uploadingPdf}
                className="hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  void handlePdfUpload(file);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={agentLoading}
              onClick={() => {
                const p = '上架「富智慧频率密码健康仪（三段能量 AI 变频系统）」，零售价 39800 元，品牌结算价 23800 元，划线价 49800 元，库存 100 台。核心卖点：国家外观设计专利 ZL 2025 3 0195027.X（智能频率健康仪），上照射口频率能量 + 中段最大 700 uT 旋磁能量 + 下方 8-14 微米体感光波（峰值波长 9.4 微米、发射率 0.92±0.02）+ AI 智能侦测自动变频与远程运营后台。';
                setAgentPrompt(p);
                void runProductAgent({ presetPrompt: p, autoPublish: false });
              }}
              className="rounded-full border border-amber-300/60 bg-amber-400/15 px-3.5 py-1.5 text-xs font-black text-amber-200 hover:bg-amber-400/25"
            >
              ⚡ 一键载入旗舰单品：富智慧频率密码健康仪（三段能量系统）
            </button>
            <button
              type="button"
              disabled={agentLoading}
              onClick={() => {
                const p = '把售价改成 29800，品牌结算价改成 16800，划线价 36800，库存改成 200 台，突出门店体验引流与居家非接触式温热放松';
                setAgentPrompt(p);
                void runProductAgent({ presetPrompt: p, autoPublish: false });
              }}
              className="rounded-full border border-teal-400/40 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-teal-100 hover:bg-white/20"
            >
              💬 AI 对话改稿示例：「把售价改成 29800，结算价 16800，突出居家与门店体验」
            </button>
          </div>

          <div className="mt-3">
            <textarea
              rows={3}
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              placeholder="在此输入一句话指令或粘贴任意商品资料（例如：上架智能频率健康仪，售价39800，供货价23800；或对已填好的商品说：把价格改成 19800、库存改成 300）..."
              className="w-full rounded-xl border border-teal-500/40 bg-black/30 p-3.5 text-sm font-semibold text-white placeholder-teal-200/50 outline-none focus:border-amber-400"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={agentLoading}
              onClick={() => void runProductAgent({ autoPublish: false })}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-black text-stone-950 shadow hover:bg-amber-300 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {agentLoading ? 'Agent 生成中...' : '✨ AI 一键生成 / 按指令修改下方表单'}
            </button>
            <button
              type="button"
              disabled={agentLoading}
              onClick={() => void runProductAgent({ autoPublish: true })}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow hover:bg-emerald-500 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" />
              {agentLoading ? '极速上架中...' : '🚀 AI 一键生成并立即上架商城（免等待直接开卖）'}
            </button>
          </div>

          {agentReply ? (
            <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-950/70 p-3.5 text-xs font-bold text-emerald-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{agentReply}</span>
                {publishedProductId ? (
                  <div className="flex flex-wrap gap-2">
                    <Link href="/cn/shop" className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-black text-stone-950">前往商城查看 →</Link>
                    <Link href={`/vendor/products/${publishedProductId}/edit`} className="rounded-lg border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-black text-white">继续 AI 编辑该商品</Link>
                    <Link href="/vendor" className="rounded-lg border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-black text-white">返回工作台</Link>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {/* PDF Draft Recognition Result / Error Banner */}
        {pdfNotice ? (
          <section role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
            <div className="font-black">{pdfNotice}</div>
            {pdfWarnings.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-semibold text-emerald-900">
                {pdfWarnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {pdfError ? (
          <section role="alert" className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <div className="flex items-center gap-2 font-black text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>PDF 草稿读取失败</span>
            </div>
            <p className="mt-1 font-semibold">{pdfError}</p>
            <p className="mt-1 text-xs font-bold text-red-700">
              建议：请确认上传的文件为小于 25MB 的有效 PDF 文档，或直接使用上方「阿富 AI 商品 Agent 大脑」输入一句话自动填满全部栏位。
            </p>
          </section>
        ) : null}

        {/* Live Commission & Margin Preview Bar */}
        {retailNum > 0 ? (
          <section className="mt-4 grid gap-3 rounded-xl border border-teal-200 bg-teal-50/80 p-4 text-sm text-teal-950 sm:grid-cols-4">
            <div>
              <div className="text-xs font-bold text-teal-700">零售价 / 品牌结算价</div>
              <div className="mt-0.5 font-black">¥{retailNum.toLocaleString()} / ¥{supplyNum.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-teal-700">单件可分配推广池（扣0.6%通道费）</div>
              <div className="mt-0.5 font-black text-emerald-800">¥{poolNum.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-teal-700">直推 {form.directRate}% / 间推 {form.upperRate}%</div>
              <div className="mt-0.5 font-black">¥{Math.round(poolNum * Number(form.directRate || 0) / 100).toLocaleString()} / ¥{Math.round(poolNum * Number(form.upperRate || 0) / 100).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-teal-700">近30天贡献奖金池 ({form.activeRate}%)</div>
              <div className="mt-0.5 font-black text-amber-800">¥{Math.round(poolNum * Number(form.activeRate || 0) / 100).toLocaleString()}</div>
            </div>
          </section>
        ) : null}

        {draftSavedNotice ? (
          <div role="status" className="mt-4 rounded-xl border border-teal-300 bg-teal-50 p-4 text-sm font-black text-teal-900">
            {draftSavedNotice}
          </div>
        ) : null}

        {error ? (
          <div ref={errorBannerRef} role="alert" className="mt-4 rounded-xl border-2 border-red-400 bg-red-50 p-4 text-sm font-black text-red-900 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} noValidate className="mt-6 grid gap-4 rounded-xl border border-stone-200 bg-white p-6 md:grid-cols-2">
          <div>
            <label className="label">商品名称 <span className="text-red-600">*</span></label>
            <input
              ref={setFieldRef('name') as React.Ref<HTMLInputElement>}
              className={`input-field ${fieldErrors.name ? 'border-red-500 bg-red-50/30' : ''}`}
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
            />
            {fieldErrors.name ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.name}</p> : null}
          </div>
          <div>
            <label className="label">商品分类 <span className="text-red-600">*</span></label>
            <input
              ref={setFieldRef('category') as React.Ref<HTMLInputElement>}
              className={`input-field ${fieldErrors.category ? 'border-red-500 bg-red-50/30' : ''}`}
              value={form.category}
              onChange={(e) => setField('category', e.target.value)}
              aria-invalid={Boolean(fieldErrors.category)}
            />
            {fieldErrors.category ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.category}</p> : null}
          </div>
          <div>
            <label className="label">SKU（选填）</label>
            <input className="input-field" value={form.sku} onChange={(e) => setField('sku', e.target.value)} />
          </div>
          <div>
            <label className="label">售价（人民币） <span className="text-red-600">*</span></label>
            <input
              ref={setFieldRef('priceCny') as React.Ref<HTMLInputElement>}
              type="number"
              className={`input-field ${fieldErrors.priceCny ? 'border-red-500 bg-red-50/30' : ''}`}
              value={form.priceCny}
              onChange={(e) => setField('priceCny', e.target.value)}
              placeholder="例如：39800"
              aria-invalid={Boolean(fieldErrors.priceCny)}
            />
            {fieldErrors.priceCny ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.priceCny}</p> : null}
          </div>
          <div>
            <label className="label">划线价 / 原价（选填）</label>
            <input
              ref={setFieldRef('compareAtPrice') as React.Ref<HTMLInputElement>}
              type="number"
              className={`input-field ${fieldErrors.compareAtPrice ? 'border-red-500 bg-red-50/30' : ''}`}
              value={form.compareAtPrice}
              onChange={(e) => setField('compareAtPrice', e.target.value)}
            />
            {fieldErrors.compareAtPrice ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.compareAtPrice}</p> : null}
          </div>
          <div>
            <label className="label">品牌供货结算价（人民币） <span className="text-red-600">*</span></label>
            <input
              ref={setFieldRef('supplyPriceCny') as React.Ref<HTMLInputElement>}
              type="number"
              className={`input-field ${fieldErrors.supplyPriceCny ? 'border-red-500 bg-red-50/30' : ''}`}
              value={form.supplyPriceCny}
              onChange={(e) => setField('supplyPriceCny', e.target.value)}
              placeholder="须低于售价，例如：23800"
              aria-invalid={Boolean(fieldErrors.supplyPriceCny)}
            />
            {fieldErrors.supplyPriceCny ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.supplyPriceCny}</p> : null}
          </div>
          <div>
            <label className="label">库存数量 <span className="text-red-600">*</span></label>
            <input
              ref={setFieldRef('stockQuantity') as React.Ref<HTMLInputElement>}
              type="number"
              className={`input-field ${fieldErrors.stockQuantity ? 'border-red-500 bg-red-50/30' : ''}`}
              value={form.stockQuantity}
              onChange={(e) => setField('stockQuantity', e.target.value)}
              aria-invalid={Boolean(fieldErrors.stockQuantity)}
            />
            {fieldErrors.stockQuantity ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.stockQuantity}</p> : null}
          </div>
          <div>
            <label className="label">商品主图路径或图片网址 <span className="text-red-600">*</span></label>
            <div className="flex gap-2">
              <input
                ref={setFieldRef('imageUrl') as React.Ref<HTMLInputElement>}
                className={`input-field flex-1 ${fieldErrors.imageUrl ? 'border-red-500 bg-red-50/30' : ''}`}
                value={form.imageUrl}
                onChange={(e) => setField('imageUrl', e.target.value)}
              />
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-teal-700 bg-teal-50 px-3 py-2 text-xs font-black text-teal-800 hover:bg-teal-100">
                <UploadCloud className="h-4 w-4" />{uploadingImage ? '上传中...' : '上传图片'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingImage} onChange={(e) => { void uploadProductImage(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
              </label>
            </div>
            {fieldErrors.imageUrl ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.imageUrl}</p> : null}
          </div>
          <div className="md:col-span-2">
            <label className="label">商品说明 / 核心卖点（必填，不可含医疗疗效宣称） <span className="text-red-600">*</span></label>
            <textarea
              ref={setFieldRef('description') as React.Ref<HTMLTextAreaElement>}
              className={`input-field ${fieldErrors.description ? 'border-red-500 bg-red-50/30' : ''}`}
              rows={6}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="请填写商品核心规格、适用场景与卖点说明（或点击上方 AI 一键生成）"
              aria-invalid={Boolean(fieldErrors.description)}
            />
            {fieldErrors.description ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.description}</p> : null}
          </div>
          <div className="md:col-span-2"><label className="label">多规格选项（每行一组，如 规格: 标准装, 家庭装）</label><textarea className="input-field" rows={2} value={form.variantText} onChange={(e) => setField('variantText', e.target.value)} /></div>
          <div><label className="label">配送方式（顿号或逗号分隔）</label><input className="input-field" value={form.shippingMethodsText} onChange={(e) => setField('shippingMethodsText', e.target.value)} /></div>
          <div>
            <label className="label">发货方式与时效说明 <span className="text-red-600">*</span></label>
            <input
              ref={setFieldRef('fulfillmentInfo') as React.Ref<HTMLInputElement>}
              className={`input-field ${fieldErrors.fulfillmentInfo ? 'border-red-500 bg-red-50/30' : ''}`}
              value={form.fulfillmentInfo}
              onChange={(e) => setField('fulfillmentInfo', e.target.value)}
              aria-invalid={Boolean(fieldErrors.fulfillmentInfo)}
            />
            {fieldErrors.fulfillmentInfo ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors.fulfillmentInfo}</p> : null}
          </div>
          <div className="grid grid-cols-3 gap-2 md:col-span-2">
            <div><label className="label">直推比例%</label><input ref={setFieldRef('directRate') as React.Ref<HTMLInputElement>} type="number" className="input-field" value={form.directRate} onChange={(e) => setField('directRate', e.target.value)} /></div>
            <div><label className="label">上层比例%</label><input ref={setFieldRef('upperRate') as React.Ref<HTMLInputElement>} type="number" className="input-field" value={form.upperRate} onChange={(e) => setField('upperRate', e.target.value)} /></div>
            <div><label className="label">贡献池比例%</label><input ref={setFieldRef('activeRate') as React.Ref<HTMLInputElement>} type="number" className="input-field" value={form.activeRate} onChange={(e) => setField('activeRate', e.target.value)} /></div>
            {fieldErrors.directRate ? <p className="col-span-3 text-xs font-bold text-red-600">{fieldErrors.directRate}</p> : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-sm font-black text-red-800 md:col-span-2">
              ⚠️ {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 md:col-span-2">
            <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-6 py-3 font-black text-white shadow hover:bg-teal-800 disabled:opacity-50">
              {submitting ? '提交中...' : '提交平台审核'}
            </button>
            <button type="button" disabled={submitting} onClick={() => void submitWithMode(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 font-black text-white shadow hover:bg-emerald-600 disabled:opacity-50">
              <CheckCircle2 className="h-4 w-4" />
              {submitting ? '处理中...' : '🚀 立即上架商城（AI 合规秒批生效）'}
            </button>
            <button type="button" onClick={saveDraft} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-800 hover:bg-stone-50">
              <Save className="h-4 w-4" />
              保存草稿
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
