'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ChevronDown, FileText, ImagePlus, MoreHorizontal, Send, Sparkles, X } from 'lucide-react';
import {
  detectSharedDeviceText,
  emptyProductForm,
  isSharedDeviceListing,
  productFieldLabels,
  productPdfCandidate,
  productPdfError,
  type ProductFormValues,
  validateProductForm,
} from '@/lib/vendor-product-form-feedback';

const PRODUCT_DRAFT_STORAGE_KEY = 'richsmart_cn_vendor_new_product_draft';

// 新增商品页：分类 / 封面 / 库存不预填，避免把示意值当成真实资料提交
const initialForm: ProductFormValues = { ...emptyProductForm, category: '', imageUrl: '', stockQuantity: '' };


type FieldKey = keyof ProductFormValues;
type MissingItem = { key: FieldKey; label: string; hint: string; guessed: boolean; optional?: boolean };

// 共享设备（投放合作）不标价、不发货：售价 / 供货价 / 库存 / 发货方式不需要
const RETAIL_ONLY_KEYS: FieldKey[] = ['priceCny', 'supplyPriceCny', 'compareAtPrice', 'stockQuantity', 'fulfillmentInfo'];

function missingOrderFor(form: ProductFormValues) {
  const shared = isSharedDeviceListing(form.listingType);
  return MISSING_ORDER.filter((row) => !shared || !RETAIL_ONLY_KEYS.includes(row.key));
}

const MISSING_ORDER: Array<{ key: FieldKey; label: string; optional?: boolean }> = [
  { key: 'name', label: '商品名称' },
  { key: 'category', label: '商品分类' },
  { key: 'priceCny', label: '售价（元）' },
  { key: 'supplyPriceCny', label: '品牌结算价 / 供货价（元）' },
  { key: 'imageUrl', label: '封面图' },
  { key: 'stockQuantity', label: '库存数量' },
  { key: 'variantText', label: '规格（选填，如 规格: 标准装, 家庭装）', optional: true },
  { key: 'description', label: '商品说明 / 卖点' },
  { key: 'fulfillmentInfo', label: '发货方式与时效' },
];

function readApiError(data: any, fallback: string) {
  if (data && typeof data === 'object') {
    for (const key of ['message', 'error']) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return fallback;
}

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isPlaceholderImage(url: string) {
  const value = String(url || '').trim();
  return !value || value.startsWith('/images/');
}

function numberInText(value: string, source: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || !source) return false;
  const plain = source.replace(/[,，\s]/g, '');
  const variants = new Set([String(value).trim(), String(n), String(Math.round(n))]);
  return Array.from(variants).some((v) => v && plain.includes(v));
}

// 找出仍缺少、或由 AI 推测（原始资料里找不到）的必填项
function findMissing(form: ProductFormValues, sourceText: string, aiUsed: boolean, hasUserImage: boolean): MissingItem[] {
  const errors = validateProductForm(form);
  const source = sourceText.trim();
  const items: MissingItem[] = [];
  for (const row of missingOrderFor(form)) {
    const value = String(form[row.key] || '').trim();
    let missing = false;
    let guessed = false;
    let hint = '';
    if (row.key === 'imageUrl') {
      if (!hasUserImage && isPlaceholderImage(value)) { missing = true; hint = '请上传一张商品实拍图作为封面'; }
    } else if (row.optional) {
      if (!value) { missing = true; hint = '没有规格可留空'; }
    } else if (!value || errors[row.key as keyof typeof errors]) {
      missing = true;
      hint = errors[row.key as keyof typeof errors] || '请填写';
    } else if (aiUsed && ['priceCny', 'supplyPriceCny', 'stockQuantity'].includes(row.key) && !numberInText(value, source)) {
      guessed = true; hint = 'AI 推测值，原始资料中未找到，请确认';
    } else if (aiUsed && (row.key === 'name' || row.key === 'category') && source && !source.replace(/\s/g, '').includes(value.replace(/\s/g, ''))) {
      guessed = true; hint = row.key === 'name' ? 'AI 推测名称，请确认' : 'AI 推测分类，请确认';
    }
    if (missing || guessed) items.push({ key: row.key, label: row.label, hint, guessed, optional: row.optional });
  }
  // 规格只在还有其他缺项时一起询问，避免为选填项单独弹窗
  return items.some((item) => !item.optional) ? items : [];
}

export default function NewVendorProductPage() {
  const router = useRouter();
  const [form, setForm] = useState<ProductFormValues>(initialForm);
  const [gallery, setGallery] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // 丢资料
  const [sourceText, setSourceText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateStep, setGenerateStep] = useState('');

  // 缺项弹窗
  const [missing, setMissing] = useState<MissingItem[]>([]);
  const [missingDraft, setMissingDraft] = useState<Partial<Record<FieldKey, string>>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogUploading, setDialogUploading] = useState(false);

  const [moreOpen, setMoreOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});
  const errorBannerRef = useRef<HTMLDivElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          const { gallery: savedGallery, ...rest } = parsed as Record<string, any>;
          setForm((current) => ({ ...current, ...rest }));
          if (Array.isArray(savedGallery)) setGallery(savedGallery.filter((u) => typeof u === 'string'));
        }
      }
    } catch {
      // ignore invalid local storage
    }
    if (window.matchMedia?.('(min-width: 768px)').matches) setFormOpen(true);
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data?.user;
        setIsAdmin(Boolean(user?.platformAdmin || user?.role === 'admin' || user?.role === 'super_admin'));
      })
      .catch(() => setIsAdmin(false));
  }, []);

  const setFieldRef = (key: FieldKey) => (el: HTMLElement | null) => {
    fieldRefs.current[key] = el;
  };

  const setField = (key: FieldKey, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const uploadImage = async (file: File) => {
    const body = new FormData();
    body.set('file', file);
    body.set('purpose', 'product');
    const res = await fetch('/api/cn/brand-assets', { method: 'POST', body });
    const data = await readJson(res);
    if (!res.ok || !data?.asset?.url) throw new Error(readApiError(data, `图片「${file.name}」上传失败`));
    return String(data.asset.url);
  };

  const saveDraft = () => {
    try {
      window.localStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify({ ...form, gallery }));
      setNotice('草稿已保存在本机浏览器。');
    } catch {
      setError('浏览器无法保存本地草稿，请直接填写并提交。');
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files);
    const pdf = list.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const images = list.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (pdf) setPdfFile(pdf);
    if (images.length) setImageFiles((current) => [...current, ...images].slice(0, 9));
    if (!pdf && !images.length) setError('只支持 PDF 或 JPG / PNG / WEBP 图片');
  };

  // ② AI 生成：上传图片 → 读取 PDF → AI 解析文字 → 列出缺项
  const generate = async () => {
    const text = sourceText.trim();
    if (!text && !pdfFile && !imageFiles.length) {
      setError('请先粘贴商品资料，或附上 PDF / 图片');
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    let next: ProductFormValues = { ...form };
    let nextGallery = [...gallery];
    const warnings: string[] = [];
    try {
      if (imageFiles.length) {
        setGenerateStep('上传图片…');
        const urls: string[] = [];
        for (const file of imageFiles) urls.push(await uploadImage(file));
        const userCoverExists = !isPlaceholderImage(next.imageUrl);
        if (!userCoverExists) next.imageUrl = urls[0];
        nextGallery = Array.from(new Set([...nextGallery, ...(userCoverExists ? urls : urls.slice(1))])).filter((u) => u !== next.imageUrl);
        setImageFiles([]);
      }
      if (pdfFile) {
        setGenerateStep('读取 PDF…');
        const body = new FormData();
        body.set('file', pdfFile);
        const res = await fetch('/api/cn/product-draft-from-pdf', { method: 'POST', body });
        const data = await readJson(res);
        if (!res.ok) throw new Error(`PDF 读取失败：${productPdfError(data, res.status)}`);
        const candidate = productPdfCandidate(data?.draft || data);
        const keepCover = !isPlaceholderImage(next.imageUrl) ? next.imageUrl : '';
        next = { ...next, ...candidate };
        if (keepCover) next.imageUrl = keepCover;
        if (Array.isArray(data?.warnings)) warnings.push(...data.warnings.map((w: unknown) => String(w)));
        setPdfFile(null);
      }
      if (text) {
        setGenerateStep('AI 解析资料…');
        const res = await fetch('/api/cn/agent-brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'product_generate', prompt: text, currentForm: next, autoPublish: false }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(readApiError(data, 'AI 生成失败'));
        if (data?.draft && typeof data.draft === 'object') {
          const keepCover = !isPlaceholderImage(next.imageUrl) ? next.imageUrl : '';
          const draft: Record<string, string> = {};
          for (const [key, value] of Object.entries(data.draft)) {
            if (key in initialForm && (typeof value === 'string' || typeof value === 'number')) draft[key] = String(value);
          }
          next = { ...next, ...draft };
          next.listingType = isSharedDeviceListing(draft.listingType) || detectSharedDeviceText(text) || isSharedDeviceListing(form.listingType) ? 'shared_device' : 'retail';
          // AI 示意图不当作封面
          next.imageUrl = keepCover || (isPlaceholderImage(next.imageUrl) ? '' : next.imageUrl);
        }
      }
      if (!text && detectSharedDeviceText(`${next.name} ${next.description}`)) next.listingType = 'shared_device';
      setForm(next);
      setGallery(nextGallery);
      setFieldErrors({});
      const hasUserImage = !isPlaceholderImage(next.imageUrl);
      const items = findMissing(next, text, Boolean(text), hasUserImage);
      setMissing(items);
      setMissingDraft(Object.fromEntries(items.map((item) => [item.key, item.key === 'imageUrl' ? '' : String(next[item.key] || '')])));
      if (items.length) {
        setDialogOpen(true);
      } else {
        setNotice('资料已齐全，请核对后提交审核。');
        setTimeout(() => submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      }
      if (warnings.length) setNotice((current) => [current, ...warnings].filter(Boolean).join('；'));
    } catch (err) {
      setForm(next);
      setGallery(nextGallery);
      setError(err instanceof Error ? err.message : 'AI 生成失败');
    } finally {
      setGenerating(false);
      setGenerateStep('');
    }
  };

  const applyMissing = () => {
    const merged: ProductFormValues = { ...form };
    for (const item of missing) {
      const value = String(missingDraft[item.key] ?? '').trim();
      if (item.key === 'imageUrl') {
        if (value) merged.imageUrl = value;
      } else if (value || item.optional) {
        (merged as Record<string, string>)[item.key] = value;
      }
    }
    setForm(merged);
    setFieldErrors({});
    setDialogOpen(false);
    const remaining = findMissing(merged, '', false, !isPlaceholderImage(merged.imageUrl)).filter((item) => !item.optional);
    if (remaining.length) {
      setError(`还缺：${remaining.map((item) => item.label).join('、')}，可在下方完整资料中补充`);
      setFormOpen(true);
    } else {
      setNotice('资料已齐全，请核对后提交。');
      setTimeout(() => submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  };

  const uploadCoverInDialog = async (file?: File) => {
    if (!file) return;
    setDialogUploading(true);
    try {
      const url = await uploadImage(file);
      setMissingDraft((current) => ({ ...current, imageUrl: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '封面上传失败');
    } finally {
      setDialogUploading(false);
    }
  };

  const uploadCoverInForm = async (file?: File) => {
    if (!file) return;
    setUploadingImage(true);
    setError('');
    try {
      setField('imageUrl', await uploadImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : '商品图片上传失败');
    } finally {
      setUploadingImage(false);
    }
  };

  const focusFirstFieldError = (nextErrors: Partial<Record<FieldKey, string>>) => {
    const order: FieldKey[] = ['name', 'category', 'priceCny', 'compareAtPrice', 'supplyPriceCny', 'stockQuantity', 'imageUrl', 'description', 'fulfillmentInfo', 'directRate', 'upperRate', 'activeRate'];
    const firstKey = order.find((key) => Boolean(nextErrors[key]));
    const el = firstKey ? fieldRefs.current[firstKey] : null;
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ③ 提交：服务器决定状态（平台管理员直接上架，其他账号一律待审核）
  const shared = isSharedDeviceListing(form.listingType);
  const setListingType = (value: 'retail' | 'shared_device') => {
    setForm((current) => ({ ...current, listingType: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of RETAIL_ONLY_KEYS) delete next[key];
      return next;
    });
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    setNotice('');
    const nextErrors: Partial<Record<FieldKey, string>> = { ...validateProductForm(form) };
    if (isPlaceholderImage(form.imageUrl)) nextErrors.imageUrl = '请上传商品封面图';
    setFieldErrors(nextErrors);
    const keys = Object.keys(nextErrors) as FieldKey[];
    if (keys.length) {
      setFormOpen(true);
      setError(`请完善以下必填项后再提交：${keys.map((key) => (key === 'imageUrl' ? '封面图' : productFieldLabels[key as keyof typeof productFieldLabels] || key)).join('、')}`);
      setTimeout(() => focusFirstFieldError(nextErrors), 60);
      return;
    }
    setSubmitting(true);
    try {
      const images = Array.from(new Set([form.imageUrl, ...gallery].map((u) => String(u || '').trim()).filter(Boolean))).slice(0, 12);
      const res = await fetch('/api/vendor/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shared
          ? { ...form, images, listingType: 'shared_device', priceCny: '', supplyPriceCny: '', compareAtPrice: '', stockQuantity: '', fulfillmentInfo: '' }
          : { ...form, images, listingType: 'retail', cooperationNote: '' }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(readApiError(data, `提交失败（${res.status}）`));
      try {
        window.localStorage.removeItem(PRODUCT_DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }
      router.push(data?.reviewStatus === 'approved' ? '/vendor?submitted=approved' : '/vendor?submitted=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const retailNum = Number(form.priceCny || 0);
  const supplyNum = Number(form.supplyPriceCny || 0);
  const feeNum = retailNum > 0 ? Math.round(retailNum * 0.006 * 100) / 100 : 0;
  const poolNum = retailNum > supplyNum ? Math.max(0, Math.round((retailNum - supplyNum - feeNum) * 100) / 100) : 0;
  const filledCount = missingOrderFor(form).filter((row) => !row.optional && String(form[row.key] || '').trim() && !(row.key === 'imageUrl' && isPlaceholderImage(form.imageUrl))).length;
  const requiredCount = missingOrderFor(form).filter((row) => !row.optional).length;
  const inputClass = (key: FieldKey, extra = '') => `input-field ${extra} ${fieldErrors[key] ? 'border-red-500 bg-red-50/30' : ''}`;
  const fieldError = (key: FieldKey) => (fieldErrors[key] ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors[key]}</p> : null);

  return (
    <main className="min-h-screen bg-[#f5f2ea] px-4 py-6 text-stone-950 md:py-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <Link href="/vendor" className="inline-flex items-center gap-1.5 text-sm font-bold text-stone-600"><ArrowLeft className="h-4 w-4" />工作台</Link>
          <div className="relative">
            <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-bold text-stone-700">
              <MoreHorizontal className="h-4 w-4" />更多
            </button>
            {moreOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-stone-200 bg-white text-sm font-semibold shadow-lg">
                <Link href="/vendor/products/bulk" className="block px-4 py-3 hover:bg-stone-50">批量 CSV 导入</Link>
                <button type="button" className="block w-full border-t border-stone-100 px-4 py-3 text-left hover:bg-stone-50" onClick={() => { setMoreOpen(false); saveDraft(); }}>保存草稿到本机</button>
                <Link href="/cn/shop" className="block border-t border-stone-100 px-4 py-3 text-teal-700 hover:bg-stone-50">前往商城</Link>
              </div>
            ) : null}
          </div>
        </div>

        <header className="mt-5">
          <h1 className="text-2xl font-black leading-tight">新增商品</h1>
          <ol className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-stone-500">
            <li>① 丢资料</li><li aria-hidden="true" className="text-stone-300">›</li>
            <li>② AI 生成</li><li aria-hidden="true" className="text-stone-300">›</li>
            <li>③ {isAdmin ? '提交并上架' : '提交审核'}</li>
          </ol>
        </header>

        {/* 商品类型 */}
        <div role="radiogroup" aria-label="商品类型" className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-stone-200 bg-white p-1.5">
          {([
            { value: 'retail', title: '零售商品', sub: '标价销售 · 下单发货' },
            { value: 'shared_device', title: '共享设备', sub: '投放合作 · 不标价' },
          ] as const).map((option) => {
            const active = (option.value === 'shared_device') === shared;
            return (
              <button key={option.value} type="button" role="radio" aria-checked={active} onClick={() => setListingType(option.value)} className={`rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-teal-700 text-white shadow-sm' : 'text-stone-700 hover:bg-stone-50'}`}>
                <span className="block text-sm font-black">{option.title}</span>
                <span className={`mt-0.5 block text-[11px] font-bold ${active ? 'text-teal-50' : 'text-stone-500'}`}>{option.sub}</span>
              </button>
            );
          })}
        </div>
        {shared ? <p className="mt-2 px-1 text-xs font-semibold text-stone-500">共享设备不标售价、不走购物车；商城显示「投放合作 · 洽谈」，客户留资料后由品牌方联系。</p> : null}

        {/* ① 丢资料 */}
        <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <textarea
            rows={5}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            placeholder={shared ? '粘贴设备介绍 / 投放合作方式（名称、功能、合作模式）…' : '粘贴商品介绍 / 微信文案（含名称、售价、供货价、库存更快）…'}
            className="w-full resize-y rounded-xl border border-stone-200 bg-stone-50 p-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm font-bold text-stone-700 hover:bg-stone-50">
              <ImagePlus className="h-4 w-4" />附 PDF / 图片
              <input type="file" multiple accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
            </label>
            {pdfFile ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700"><FileText className="h-3.5 w-3.5" />{pdfFile.name}<button type="button" aria-label="移除 PDF" onClick={() => setPdfFile(null)}><X className="h-3.5 w-3.5" /></button></span>
            ) : null}
            {imageFiles.map((file, idx) => (
              <span key={`${file.name}-${idx}`} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700">{idx === 0 && isPlaceholderImage(form.imageUrl) ? '封面 · ' : ''}{file.name}<button type="button" aria-label="移除图片" onClick={() => setImageFiles((cur) => cur.filter((_, i) => i !== idx))}><X className="h-3.5 w-3.5" /></button></span>
            ))}
          </div>
          <button
            type="button"
            disabled={generating}
            onClick={() => void generate()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3.5 text-base font-black text-white shadow hover:bg-teal-800 disabled:opacity-60"
          >
            <Sparkles className="h-5 w-5" />{generating ? (generateStep || 'AI 生成中…') : 'AI 生成'}
          </button>
        </section>

        {notice ? <div role="status" className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm font-bold text-teal-900">{notice}</div> : null}
        {error ? (
          <div ref={errorBannerRef} role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        ) : null}

        {/* 完整资料（次要，手机默认折叠） */}
        <form onSubmit={submit} noValidate className="mt-4">
          <div className="rounded-2xl border border-stone-200 bg-white">
            <button type="button" onClick={() => setFormOpen((v) => !v)} aria-expanded={formOpen} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className="text-sm font-black text-stone-800">完整资料 <span className="font-bold text-stone-500">· 必填 {filledCount}/{requiredCount}</span></span>
              <ChevronDown className={`h-4 w-4 text-stone-500 transition ${formOpen ? 'rotate-180' : ''}`} />
            </button>
            {formOpen ? (
              <div className="grid gap-3 border-t border-stone-100 p-4 text-sm md:grid-cols-2">
                <div><label className="label">商品名称 *</label><input ref={setFieldRef('name') as React.Ref<HTMLInputElement>} className={inputClass('name')} value={form.name} onChange={(e) => setField('name', e.target.value)} />{fieldError('name')}</div>
                <div><label className="label">商品分类 *</label><input ref={setFieldRef('category') as React.Ref<HTMLInputElement>} className={inputClass('category')} value={form.category} onChange={(e) => setField('category', e.target.value)} placeholder="例如：健康食品" />{fieldError('category')}</div>
                {!shared ? (
                  <>
                <div><label className="label">售价（元）*</label><input ref={setFieldRef('priceCny') as React.Ref<HTMLInputElement>} type="number" inputMode="decimal" className={inputClass('priceCny')} value={form.priceCny} onChange={(e) => setField('priceCny', e.target.value)} />{fieldError('priceCny')}</div>
                <div><label className="label">品牌结算价 / 供货价（元）*</label><input ref={setFieldRef('supplyPriceCny') as React.Ref<HTMLInputElement>} type="number" inputMode="decimal" className={inputClass('supplyPriceCny')} value={form.supplyPriceCny} onChange={(e) => setField('supplyPriceCny', e.target.value)} placeholder="须低于售价" />{fieldError('supplyPriceCny')}</div>
                <div><label className="label">划线价（选填）</label><input ref={setFieldRef('compareAtPrice') as React.Ref<HTMLInputElement>} type="number" inputMode="decimal" className={inputClass('compareAtPrice')} value={form.compareAtPrice} onChange={(e) => setField('compareAtPrice', e.target.value)} />{fieldError('compareAtPrice')}</div>
                <div><label className="label">库存数量 *</label><input ref={setFieldRef('stockQuantity') as React.Ref<HTMLInputElement>} type="number" inputMode="numeric" className={inputClass('stockQuantity')} value={form.stockQuantity} onChange={(e) => setField('stockQuantity', e.target.value)} />{fieldError('stockQuantity')}</div>
                  </>
                ) : null}
                <div className="md:col-span-2">
                  <label className="label">封面图 *</label>
                  <div className="flex items-center gap-2">
                    {!isPlaceholderImage(form.imageUrl) ? <img src={form.imageUrl} alt="封面" className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 object-cover" /> : null}
                    <input ref={setFieldRef('imageUrl') as React.Ref<HTMLInputElement>} className={inputClass('imageUrl', 'flex-1')} value={form.imageUrl} onChange={(e) => setField('imageUrl', e.target.value)} placeholder="上传或粘贴图片网址" />
                    <label className="inline-flex shrink-0 cursor-pointer items-center rounded-lg border border-teal-700 px-3 py-2 text-xs font-black text-teal-800">
                      {uploadingImage ? '上传中…' : '上传'}
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingImage} onChange={(e) => { void uploadCoverInForm(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                    </label>
                  </div>
                  {fieldError('imageUrl')}
                  {gallery.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {gallery.map((url) => (
                        <span key={url} className="relative">
                          <img src={url} alt="图集" className="h-12 w-12 rounded-lg border border-stone-200 object-cover" />
                          <button type="button" aria-label="移除" onClick={() => setGallery((cur) => cur.filter((u) => u !== url))} className="absolute -right-1.5 -top-1.5 rounded-full bg-stone-800 p-0.5 text-white"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="md:col-span-2"><label className="label">商品说明 / 卖点 *（不可含医疗疗效宣称）</label><textarea ref={setFieldRef('description') as React.Ref<HTMLTextAreaElement>} rows={5} className={inputClass('description')} value={form.description} onChange={(e) => setField('description', e.target.value)} />{fieldError('description')}</div>
                <div className="md:col-span-2"><label className="label">规格（每行一组，如 规格: 标准装, 家庭装）</label><textarea rows={2} className="input-field" value={form.variantText} onChange={(e) => setField('variantText', e.target.value)} /></div>
                {shared ? (
                  <div className="md:col-span-2"><label className="label">合作方式说明（选填）</label><textarea rows={3} className="input-field" value={form.cooperationNote} onChange={(e) => setField('cooperationNote', e.target.value)} placeholder="例如：门店免费投放、按次分成，具体条件洽谈" /></div>
                ) : (
                  <>
                    <div><label className="label">发货方式与时效 *</label><input ref={setFieldRef('fulfillmentInfo') as React.Ref<HTMLInputElement>} className={inputClass('fulfillmentInfo')} value={form.fulfillmentInfo} onChange={(e) => setField('fulfillmentInfo', e.target.value)} />{fieldError('fulfillmentInfo')}</div>
                    <div><label className="label">配送方式</label><input className="input-field" value={form.shippingMethodsText} onChange={(e) => setField('shippingMethodsText', e.target.value)} /></div>
                  </>
                )}
                <div><label className="label">SKU（选填）</label><input className="input-field" value={form.sku} onChange={(e) => setField('sku', e.target.value)} /></div>
                <div className="grid grid-cols-3 gap-2 md:col-span-2">
                  <div><label className="label">直推%</label><input ref={setFieldRef('directRate') as React.Ref<HTMLInputElement>} type="number" className="input-field" value={form.directRate} onChange={(e) => setField('directRate', e.target.value)} /></div>
                  <div><label className="label">上层%</label><input ref={setFieldRef('upperRate') as React.Ref<HTMLInputElement>} type="number" className="input-field" value={form.upperRate} onChange={(e) => setField('upperRate', e.target.value)} /></div>
                  <div><label className="label">贡献池%</label><input ref={setFieldRef('activeRate') as React.Ref<HTMLInputElement>} type="number" className="input-field" value={form.activeRate} onChange={(e) => setField('activeRate', e.target.value)} /></div>
                  {fieldErrors.directRate || fieldErrors.upperRate || fieldErrors.activeRate ? <p className="col-span-3 text-xs font-bold text-red-600">{fieldErrors.directRate || fieldErrors.upperRate || fieldErrors.activeRate}</p> : null}
                </div>
                {!shared && retailNum > 0 ? (
                  <p className="rounded-lg bg-teal-50 p-2.5 text-xs font-bold text-teal-900 md:col-span-2">
                    单件推广池 ¥{poolNum.toLocaleString()}（扣 0.6% 通道费）· 直推 ¥{Math.round(poolNum * Number(form.directRate || 0) / 100).toLocaleString()} · 间推 ¥{Math.round(poolNum * Number(form.upperRate || 0) / 100).toLocaleString()} · 贡献池 ¥{Math.round(poolNum * Number(form.activeRate || 0) / 100).toLocaleString()}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ③ 提交 */}
          <button ref={submitRef} type="submit" disabled={submitting || generating} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-6 py-3.5 text-base font-black text-white shadow hover:bg-stone-800 disabled:opacity-50">
            <Send className="h-4 w-4" />{submitting ? '提交中…' : isAdmin ? '提交并上架' : '提交审核'}
          </button>
          <p className="mt-2 text-center text-xs font-semibold text-stone-500">{isAdmin ? '平台管理员提交后直接上架商城' : '提交后由平台审核，通过后上架商城'}</p>
        </form>
      </div>

      {/* 缺项弹窗 */}
      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" role="dialog" aria-modal="true" aria-labelledby="missing-title">
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl md:rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 id="missing-title" className="text-lg font-black">还差 {missing.filter((m) => !m.optional).length} 项</h2>
              <button type="button" aria-label="关闭" onClick={() => setDialogOpen(false)} className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-0.5 text-xs font-semibold text-stone-500">AI 已填好其余资料。补上这几项即可提交。</p>
            <div className="mt-3 space-y-3">
              {missing.map((item) => (
                <div key={item.key}>
                  <label className="flex items-center gap-2 text-sm font-black text-stone-800">
                    {item.label}
                    {item.guessed ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">AI 推测</span> : null}
                  </label>
                  {item.key === 'imageUrl' ? (
                    <div className="mt-1 flex items-center gap-2">
                      {missingDraft.imageUrl ? <img src={missingDraft.imageUrl} alt="封面" className="h-12 w-12 rounded-lg border object-cover" /> : null}
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal-700 px-3 py-2 text-sm font-black text-teal-800">
                        <ImagePlus className="h-4 w-4" />{dialogUploading ? '上传中…' : missingDraft.imageUrl ? '换一张' : '上传封面'}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={dialogUploading} onChange={(e) => { void uploadCoverInDialog(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                      </label>
                    </div>
                  ) : item.key === 'description' ? (
                    <textarea rows={3} className="input-field mt-1" value={missingDraft[item.key] || ''} onChange={(e) => setMissingDraft((cur) => ({ ...cur, [item.key]: e.target.value }))} />
                  ) : (
                    <input
                      className="input-field mt-1"
                      type={['priceCny', 'supplyPriceCny', 'stockQuantity'].includes(item.key) ? 'number' : 'text'}
                      inputMode={['priceCny', 'supplyPriceCny'].includes(item.key) ? 'decimal' : item.key === 'stockQuantity' ? 'numeric' : undefined}
                      value={missingDraft[item.key] || ''}
                      onChange={(e) => setMissingDraft((cur) => ({ ...cur, [item.key]: e.target.value }))}
                    />
                  )}
                  {item.hint ? <p className="mt-0.5 text-xs font-semibold text-stone-500">{item.hint}</p> : null}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setDialogOpen(false)} className="flex-1 rounded-xl border border-stone-300 px-4 py-3 text-sm font-bold text-stone-700">稍后再填</button>
              <button type="button" onClick={applyMissing} disabled={dialogUploading} className="flex-[2] rounded-xl bg-teal-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50">填入表单</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
