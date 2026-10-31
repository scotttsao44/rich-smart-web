'use client';

import Link from 'next/link';
import { type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowUp, BringToFront, Clipboard, Coins, Copy, Eye, EyeOff, Image as ImageIcon, Laptop,
  Layers, LayoutTemplate, Lock, MonitorSmartphone, Package, Plus, Redo2, Send, Smartphone,
  Sparkles, Square, Trash2, Type, Undo2, Unlock, X,
} from 'lucide-react';
import { BrandPageRenderer, type BrandPageProduct } from '@/components/brand-page/BrandPageRenderer';
import {
  BRAND_PAGE_TEMPLATES,
  createBrandPageBlock,
  createBrandPageLayer,
  createTemplateDocument,
  pageContentHeight,
  rebaseSectionLayers,
  type BrandPageBlock,
  type BrandPageBlockType,
  type BrandPageDocument,
  type BrandPageLayer,
  type BrandPageLayerType,
  type BrandPageTemplateId,
} from '@/lib/brand-page-builder';

type Brand = { id: number; slug: string; brandName: string; companyName: string; introduction: string; brandPage: { status: string; moderationNote?: string } };
type Selection = { kind: 'block' | 'layer'; id: string } | null;
type ClipboardItem = { kind: 'block'; value: BrandPageBlock; layers?: BrandPageLayer[]; top?: number } | { kind: 'layer'; value: BrandPageLayer };
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type ToolMode = 'select' | 'text' | 'image' | 'logo' | 'shape';
type BlockTextField = 'title' | 'body';
type AiCreditSummary = {
  account: { balanceCny: number; reservedCny: number; availableCny: number };
  services: Array<{ code: string; name: string; billingUnit: string; officialCurrency: string; officialUnitCost: number | null; exchangeRateToCny: number | null; exchangeRateUpdatedAt: string | null; platformServiceFeeCny: 0; enabled: boolean }>;
  quote: {
    service?: { code: string; name: string; billingUnit: string; officialCurrency: string; officialUnitCost: number | null; exchangeRateToCny: number | null; exchangeRateUpdatedAt: string | null; platformServiceFeeCny: 0; enabled: boolean };
    quantity: number;
    estimatedOfficialCostCny: number | null;
    platformServiceFeeCny: 0;
    estimatedDebitCny: number | null;
    availableCny: number;
    canConfirm: boolean;
    unavailableReason: string;
  };
  policy: { platformMarkup: boolean; platformServiceFeeCny: 0; message: string };
  recharge: { enabled: boolean; status: string; message: string };
  usages: Array<{ id: string; serviceName: string; actualDebitCny: number; status: string; completedAt: string | null; requestedAt: string }>;
  topUps: Array<{ id: string; amountCny: number; status: string; createdAt: string }>;
};

const BLOCK_LABELS: Record<BrandPageBlockType, string> = { image: '视觉区段', text: '文字区段', image_text: '图文区段', products: '商品区段', spacer: '留白区段' };
const LAYER_LABELS: Record<BrandPageLayerType, string> = { text: '文字', image: '图片', shape: '色块' };
const GRID_SIZE = 8;
const MANUAL_TEMPLATE_IDS: BrandPageTemplateId[] = ['brand_story', 'product_focus', 'editorial'];
const MANUAL_TEMPLATES = BRAND_PAGE_TEMPLATES.filter((template) => MANUAL_TEMPLATE_IDS.includes(template.id));
const BLANK_TEMPLATE = BRAND_PAGE_TEMPLATES.find((template) => template.id === 'blank') || BRAND_PAGE_TEMPLATES[BRAND_PAGE_TEMPLATES.length - 1];

function freshId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function deepClone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function cloneDocument(value: BrandPageDocument) { return deepClone(value); }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function isTypingTarget(target: EventTarget | null) { return Boolean((target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')); }
function snap(value: number, enabled: boolean) { return enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value; }
function layerName(layer: BrandPageLayer) {
  if (layer.text?.trim()) return layer.text.trim().slice(0, 18);
  if (layer.type === 'image') return layer.text === 'Logo' ? 'Logo' : '图片';
  return '色块';
}

function blockTextEditId(blockId: string, field: BlockTextField) {
  return `block:${blockId}:${field}`;
}

function ToolButton({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className={`flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border px-3 text-xs font-black disabled:opacity-30 ${active ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`}>{children}</button>;
}

function FieldNumber({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  const set = (next: number) => onChange(clamp(Number.isFinite(next) ? next : value, min, max));
  return <label className="block text-xs font-bold text-stone-600">
    <span className="flex items-center justify-between"><span>{label}</span><span className="text-stone-900">{Math.round(value * 100) / 100}{suffix}</span></span>
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_72px] gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => set(Number(event.target.value))} className="w-full accent-teal-700" />
      <input type="number" min={min} max={max} step={step} value={Math.round(value * 100) / 100} onChange={(event) => set(Number(event.target.value))} className="h-9 w-full border border-stone-300 px-2 text-right" />
    </div>
  </label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const commit = (next: string) => { if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next); };
  return <label className="block text-xs font-bold text-stone-600">
    {label}
    <div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)] gap-2">
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full border border-stone-300 bg-white p-1" />
      <input value={value} onChange={(event) => commit(event.target.value.trim())} className="h-10 border border-stone-300 px-3 font-mono text-xs" />
    </div>
  </label>;
}

function TemplatePreview({ template }: { template: (typeof BRAND_PAGE_TEMPLATES)[number] }) {
  if (template.id === 'blank') return <div className="relative aspect-[8/5] overflow-hidden border border-dashed border-stone-300 bg-white">
    <div className="absolute inset-x-5 top-5 h-px bg-stone-200" />
    <div className="absolute left-5 top-9 h-2 w-14 bg-stone-100" />
  </div>;

  if (template.id === 'product_focus') return <div className="relative aspect-[8/5] overflow-hidden" style={{ backgroundColor: template.background }}>
    <div className="absolute inset-y-0 right-0 w-[56%] overflow-hidden"><img src={template.previewImage} alt="" className="h-full w-full object-cover" /></div>
    <div className="absolute left-[8%] top-[19%] h-2 w-[20%]" style={{ backgroundColor: template.accent }} />
    <div className="absolute left-[8%] top-[35%] h-3 w-[35%] bg-stone-900" />
    <div className="absolute left-[8%] top-[51%] h-2 w-[27%] bg-stone-400" />
    <div className="absolute bottom-[13%] left-[8%] h-4 w-[23%]" style={{ backgroundColor: template.accent }} />
  </div>;

  if (template.id === 'editorial') return <div className="relative aspect-[8/5] overflow-hidden" style={{ backgroundColor: template.background }}>
    <img src={template.previewImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
    <div className="absolute inset-y-0 right-0 w-[43%] bg-[#26372e]/95" />
    <div className="absolute right-[8%] top-[18%] h-2 w-[17%] bg-[#d1a95c]" />
    <div className="absolute right-[8%] top-[36%] h-3 w-[27%] bg-[#f5f1e8]" />
    <div className="absolute right-[8%] top-[53%] h-2 w-[22%] bg-[#f5f1e8]/65" />
    <div className="absolute right-[8%] top-[66%] h-2 w-[17%] bg-[#f5f1e8]/45" />
  </div>;

  return <div className="relative aspect-[8/5] overflow-hidden" style={{ backgroundColor: template.background }}>
    <img src={template.previewImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
    <div className="absolute inset-y-0 left-0 w-[46%] bg-[#e8eee8]/95" />
    <div className="absolute left-[8%] top-[19%] h-2 w-[18%]" style={{ backgroundColor: template.accent }} />
    <div className="absolute left-[8%] top-[35%] h-3 w-[29%] bg-[#153c35]" />
    <div className="absolute left-[8%] top-[51%] h-2 w-[23%] bg-[#31584f]/70" />
    <div className="absolute bottom-[13%] left-[8%] h-4 w-[20%]" style={{ backgroundColor: template.accent }} />
  </div>;
}

function SectionThumbnail({ block, document, products, blockTop }: { block: BrandPageBlock; document: BrandPageDocument; products: BrandPageProduct[]; blockTop: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(200);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const scale = width / document.designWidth;
  return <div ref={ref} data-section-thumbnail={block.type} className="pointer-events-none relative overflow-hidden border border-stone-200 bg-white" style={{ height: block.height * scale }}>
    <div className="absolute left-0 top-0 origin-top-left" style={{ width: document.designWidth, transform: `scale(${scale})` }}>
      <div style={{ marginTop: -blockTop }}>
        <BrandPageRenderer document={document} products={products} fit={false} />
      </div>
    </div>
  </div>;
}

export default function BrandPageBuilder() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [document, setDocument] = useState<BrandPageDocument | null>(null);
  const [products, setProducts] = useState<BrandPageProduct[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'templates' | 'canvas' | 'format'>('canvas');
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<Array<{ orientation: 'h' | 'v'; value: number }>>([]);
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);
  const [undoStack, setUndoStack] = useState<BrandPageDocument[]>([]);
  const [redoStack, setRedoStack] = useState<BrandPageDocument[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const [templatePreviewId, setTemplatePreviewId] = useState<BrandPageTemplateId>('brand_story');
  const [aiTemplateStatusOpen, setAiTemplateStatusOpen] = useState(false);
  const [activeBlockTextField, setActiveBlockTextField] = useState<BlockTextField | null>(null);
  const [confirmTemplateId, setConfirmTemplateId] = useState<BrandPageTemplateId | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [aiDesignerOpen, setAiDesignerOpen] = useState(false);
  const [aiDirection, setAiDirection] = useState<'auto' | 'natural' | 'technology' | 'editorial' | 'commerce'>('auto');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerateImage, setAiGenerateImage] = useState(true);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiCredit, setAiCredit] = useState<AiCreditSummary | null>(null);
  const [aiCreditLoading, setAiCreditLoading] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const layerDragId = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const canvasScrollRef = useRef<HTMLElement | null>(null);
  const documentRef = useRef<BrandPageDocument | null>(null);
  const saveSequence = useRef(0);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const requestMutation = useCallback((action: 'save_draft' | 'publish', value: BrandPageDocument) => {
    const body = JSON.stringify({ action, document: value });
    const pending = mutationQueue.current.then(() => fetch('/api/cn/brand-page', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }));
    mutationQueue.current = pending.then(() => undefined, () => undefined);
    return pending;
  }, []);

  useEffect(() => { documentRef.current = document; }, [document]);

  useEffect(() => {
    fetch('/api/cn/brand-page').then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取品牌前页失败');
      setBrand(data.brand); setDocument(data.document); setProducts(data.products || []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '读取品牌前页失败')).finally(() => setLoading(false));
  }, []);

  const loadAiCredit = useCallback(async () => {
    setAiCreditLoading(true);
    try {
      const response = await fetch('/api/cn/brand-page/ai-credits?serviceCode=ai_brand_page_full');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取 AI 余额失败');
      setAiCredit(data);
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : '读取 AI 余额失败');
    } finally {
      setAiCreditLoading(false);
    }
  }, []);

  const commit = useCallback((updater: (current: BrandPageDocument) => BrandPageDocument) => {
    saveSequence.current += 1;
    setDocument((current) => {
      if (!current) return current;
      setUndoStack((stack) => [...stack.slice(-49), cloneDocument(current)]);
      setRedoStack([]); setDirty(true); setSaveState('saving'); setMessage('');
      const next = rebaseSectionLayers(current, updater(cloneDocument(current)));
      documentRef.current = next;
      return next;
    });
  }, []);

  const saveDraft = useCallback(async (current: BrandPageDocument, silent = false) => {
    const sequence = ++saveSequence.current;
    const snapshot = JSON.stringify(current);
    setSaveState('saving');
    try {
      const response = await requestMutation('save_draft', current);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '草稿保存失败');
      if (sequence !== saveSequence.current) return;
      setBrand(data.brand);
      if (documentRef.current && JSON.stringify(documentRef.current) === snapshot) { setDocument(data.document); setDirty(false); setSaveState('saved'); }
      if (!silent) setMessage('草稿已保存');
      return true;
    } catch (reason) { if (sequence === saveSequence.current) { setSaveState('error'); setError(reason instanceof Error ? reason.message : '草稿保存失败'); } return false; }
  }, [requestMutation]);

  useEffect(() => {
    if (!document || !dirty || publishing) return;
    const timer = window.setTimeout(() => saveDraft(document, true), 900);
    return () => window.clearTimeout(timer);
  }, [dirty, document, saveDraft, publishing]);

  const selectedBlock = useMemo(() => selection?.kind === 'block' ? document?.blocks.find((item) => item.id === selection.id) || null : null, [document, selection]);
  const selectedLayer = useMemo(() => selection?.kind === 'layer' ? document?.pageLayers.find((item) => item.id === selection.id) || null : null, [document, selection]);

  const blockTops = useMemo(() => {
    let top = 0;
    return document ? Object.fromEntries(document.blocks.map((block) => { const current = top; top += block.height; return [block.id, current]; })) : {};
  }, [document]);

  const activeSectionId = useMemo(() => {
    if (!document) return null;
    if (selection?.kind === 'block') return selection.id;
    if (selection?.kind === 'layer') {
      const layer = document.pageLayers.find((item) => item.id === selection.id);
      if (layer?.sectionId) return layer.sectionId;
      const section = document.blocks.find((block) => {
        const top = blockTops[block.id] || 0;
        return layer && layer.y >= top && layer.y < top + block.height;
      });
      return section?.id || document.blocks[0]?.id || null;
    }
    return document.blocks[0]?.id || null;
  }, [blockTops, document, selection]);

  const sectionBounds = useCallback((current: BrandPageDocument, sectionId: string | null | undefined) => {
    const fallback = current.blocks[0];
    const block = current.blocks.find((item) => item.id === sectionId) || fallback;
    const top = block ? current.blocks.slice(0, current.blocks.findIndex((item) => item.id === block.id)).reduce((sum, item) => sum + item.height, 0) : 0;
    return { id: block?.id || null, top, bottom: top + (block?.height || pageContentHeight(current)) };
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length || !document) return stack;
      const previous = stack[stack.length - 1];
      saveSequence.current += 1; documentRef.current = previous; setSaveState('saving');
      setRedoStack((redo) => [...redo, cloneDocument(document)]);
      setDocument(previous); setDirty(true);
      return stack.slice(0, -1);
    });
  }, [document]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length || !document) return stack;
      const next = stack[stack.length - 1];
      saveSequence.current += 1; documentRef.current = next; setSaveState('saving');
      setUndoStack((undoValues) => [...undoValues, cloneDocument(document)]);
      setDocument(next); setDirty(true);
      return stack.slice(0, -1);
    });
  }, [document]);

  const updateBlock = (id: string, changes: Partial<BrandPageBlock>) => commit((current) => ({ ...current, blocks: current.blocks.map((item) => item.id === id ? { ...item, ...changes } : item) }));
  const updateLayer = (id: string, changes: Partial<BrandPageLayer>) => commit((current) => ({ ...current, pageLayers: current.pageLayers.map((item) => item.id === id ? { ...item, ...changes } : item) }));
  const insertBlock = (type: BrandPageBlockType, index?: number) => {
    setEditingTextId(null);
    setMobilePanel('canvas');
    commit((current) => { const value = createBrandPageBlock(type); current.blocks.splice(index ?? current.blocks.length, 0, value); setSelection({ kind: 'block', id: value.id }); return current; });
  };
  const addLayer = (type: BrandPageLayerType) => {
    if (!document) return;
    const section = sectionBounds(document, activeSectionId);
    const value = createBrandPageLayer(type, { sectionId: section.id, y: section.top + 48, zIndex: Math.max(1, ...document.pageLayers.map((item) => item.zIndex)) + 10 });
    commit((current) => {
      current.pageLayers.push(value); setSelection({ kind: 'layer', id: value.id }); setToolMode('select'); return current;
    });
    setMobilePanel('canvas');
    if (type !== 'text') {
      setEditingTextId(null);
      return;
    }
    setEditingTextId(value.id);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const element = window.document.querySelector(`[data-layer-id="${value.id}"] [contenteditable="true"]`) as HTMLElement | null;
      element?.focus();
      if (!element) return;
      const range = window.document.createRange();
      range.selectNodeContents(element);
      const selectionValue = window.getSelection();
      selectionValue?.removeAllRanges();
      selectionValue?.addRange(range);
    }));
  };
  const moveBlock = (index: number, direction: -1 | 1) => commit((current) => { const target = index + direction; if (target < 0 || target >= current.blocks.length) return current; [current.blocks[index], current.blocks[target]] = [current.blocks[target], current.blocks[index]]; return current; });
  const switchDevice = (device: 'desktop' | 'mobile') => {
    setMobilePanel('canvas');
    commit((current) => ({ ...current, designDevice: device, designWidth: 1040 }));
  };
  const applyTemplate = async (template: BrandPageTemplateId) => {
    if (!brand || !document || applyingTemplate) return;
    setApplyingTemplate(true);
    const next = createTemplateDocument(template, brand.brandName, brand.introduction || '');
    next.draftVersion = document.draftVersion; next.publishedVersion = document.publishedVersion; next.publishedAt = document.publishedAt;
    saveSequence.current += 1;
    setUndoStack((stack) => [...stack.slice(-49), cloneDocument(document)]);
    setRedoStack([]); setDirty(true); setSaveState('saving'); setError(''); setMessage('');
    documentRef.current = next;
    setDocument(next); setSelection(null); setEditingTextId(null); setToolMode('select'); setMobilePanel('canvas');
    window.requestAnimationFrame(() => canvasScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
    const saved = await saveDraft(next, true);
    if (saved) {
      const templateName = BRAND_PAGE_TEMPLATES.find((item) => item.id === template)?.name || '模板';
      setMessage(`${templateName}完整模板已套用并保存：${next.blocks.length} 个区段、${next.pageLayers.length} 个可编辑图层`);
    }
    setApplyingTemplate(false);
  };
  const requestApplyTemplate = (template: BrandPageTemplateId) => {
    setAiTemplateStatusOpen(false);
    setTemplatePreviewId(template);
    setConfirmTemplateId(template);
  };

  const generateAiDesign = async () => {
    if (!document) return;
    setAiGenerating(true); setAiError(''); setMessage('');
    const operationKey = `ai-brand-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const response = await fetch('/api/cn/brand-page/ai-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, direction: aiDirection, generateImage: aiGenerateImage, confirmAiCharge: true, idempotencyKey: operationKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'AI 设计生成失败');
      const next = data.document as BrandPageDocument;
      next.draftVersion = document.draftVersion;
      next.publishedVersion = document.publishedVersion;
      next.publishedAt = document.publishedAt;
      commit(() => next);
      setSelection(null); setEditingTextId(null); setToolMode('select'); setMobilePanel('canvas'); setAiDesignerOpen(false);
      setMessage(String(data.notice || 'AI 页面草稿已生成'));
      loadAiCredit();
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : 'AI 设计生成失败');
      loadAiCredit();
    } finally {
      setAiGenerating(false);
    }
  };

  const blockTextLayer = useCallback((block: BrandPageBlock, field: BlockTextField) => {
    const target = canvasScrollRef.current?.querySelector<HTMLElement>(`[data-block-id="${block.id}"] [data-block-text-field="${field}"]`);
    const canvas = target?.closest<HTMLElement>('[data-brand-canvas]');
    if (!target || !canvas || !document) return null;
    const rect = target.getBoundingClientRect(); const bounds = canvas.getBoundingClientRect();
    const scale = bounds.width / document.designWidth;
    const style = window.getComputedStyle(target);
    const rgb = style.color.match(/\d+/g)?.slice(0, 3);
    return createBrandPageLayer('text', {
      sectionId: block.id, text: block[field], xPct: clamp((rect.left - bounds.left) / bounds.width * 100, 0, 95),
      y: (rect.top - bounds.top) / scale, widthPct: rect.width / bounds.width * 100, height: rect.height / scale,
      fontSize: Number.parseFloat(style.fontSize), fontWeight: Number.parseInt(style.fontWeight, 10) || 500,
      lineHeight: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize), opacity: Number.parseFloat(style.opacity) * 100,
      color: rgb ? `#${rgb.map((value) => Number(value).toString(16).padStart(2, '0')).join('')}` : block.color,
      zIndex: Math.max(1, ...document.pageLayers.map((layer) => layer.zIndex)) + 10,
    });
  }, [document]);

  const handleBlockTextPointerDown = (event: ReactPointerEvent<HTMLElement>, block: BrandPageBlock, field: BlockTextField) => {
    if (!block[field]) return;
    const layer = blockTextLayer(block, field);
    const target = event.currentTarget;
    const canvas = target.closest<HTMLElement>('[data-brand-canvas]');
    if (!layer || !canvas || !document) return;
    const scale = canvas.getBoundingClientRect().width / document.designWidth;
    const startX = event.clientX; const startY = event.clientY;
    let dx = 0; let dy = 0; let moved = false;
    const move = (next: PointerEvent) => {
      dx = (next.clientX - startX) / scale; dy = (next.clientY - startY) / scale;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; next.preventDefault(); target.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      target.style.transform = '';
      if (!moved) return;
      commit((current) => {
        const section = sectionBounds(current, block.id);
        current.blocks = current.blocks.map((value) => value.id === block.id ? { ...value, [field]: '', textPlaceholders: { ...value.textPlaceholders, [field]: layer.height } } : value);
        current.pageLayers.push({ ...layer, xPct: clamp(layer.xPct + dx / current.designWidth * 100, 0, 100 - layer.widthPct), y: clamp(layer.y + dy, section.top, Math.max(section.top, section.bottom - layer.height)) });
        return current;
      });
      setSelection({ kind: 'layer', id: layer.id }); setActiveBlockTextField(null); setEditingTextId(null);
    };
    const cancel = () => { moved = false; up(); };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };

  const copySelection = useCallback(() => {
    if (selectedBlock && activeBlockTextField) {
      const layer = blockTextLayer(selectedBlock, activeBlockTextField);
      if (layer) setClipboard({ kind: 'layer', value: layer });
      return;
    }
    if (selectedBlock && document) setClipboard({ kind: 'block', value: deepClone(selectedBlock), layers: deepClone(document.pageLayers.filter((layer) => layer.sectionId === selectedBlock.id)), top: blockTops[selectedBlock.id] || 0 });
    if (selectedLayer) setClipboard({ kind: 'layer', value: deepClone(selectedLayer) });
  }, [selectedBlock, selectedLayer, document, blockTops, activeBlockTextField, blockTextLayer]);

  const pasteSelection = useCallback((source?: ClipboardItem | null) => {
    const item = source || clipboard;
    if (!item) return;
    commit((current) => {
      if (item.kind === 'block') {
        const value = { ...deepClone(item.value), id: freshId('block') };
        const top = current.blocks.reduce((sum, block) => sum + block.height, 0);
        const layers = item.layers || current.pageLayers.filter((layer) => layer.sectionId === item.value.id);
        const sourceTop = item.top ?? current.blocks.slice(0, current.blocks.findIndex((block) => block.id === item.value.id)).reduce((sum, block) => sum + block.height, 0);
        current.pageLayers.push(...layers.map((layer) => ({ ...deepClone(layer), id: freshId('layer'), sectionId: value.id, y: layer.y - sourceTop + top })));
        current.blocks.splice(current.blocks.length, 0, value); setSelection({ kind: 'block', id: value.id });
      } else {
        const value = { ...deepClone(item.value), id: freshId('layer'), xPct: clamp(item.value.xPct + 2, 0, 94), y: item.value.y + 20, locked: false, hidden: false, zIndex: Math.max(1, ...current.pageLayers.map((layer) => layer.zIndex)) + 10 };
        current.pageLayers.push(value); setSelection({ kind: 'layer', id: value.id });
      }
      return current;
    });
    setEditingTextId(null);
    setMobilePanel('canvas');
  }, [clipboard, commit]);

  const duplicateSelection = useCallback(() => {
    if (selectedBlock && activeBlockTextField) {
      const layer = blockTextLayer(selectedBlock, activeBlockTextField);
      if (layer) pasteSelection({ kind: 'layer', value: layer });
      return;
    }
    if (selectedBlock && document) pasteSelection({ kind: 'block', value: selectedBlock, layers: document.pageLayers.filter((layer) => layer.sectionId === selectedBlock.id), top: blockTops[selectedBlock.id] || 0 });
    if (selectedLayer) pasteSelection({ kind: 'layer', value: selectedLayer });
  }, [pasteSelection, selectedBlock, selectedLayer, document, blockTops, activeBlockTextField, blockTextLayer]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selectedBlock && activeBlockTextField) {
      const layer = blockTextLayer(selectedBlock, activeBlockTextField);
      commit((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === selectedBlock.id ? { ...block, [activeBlockTextField]: '', textPlaceholders: { ...block.textPlaceholders, [activeBlockTextField]: layer?.height || 0 } } : block) }));
      setActiveBlockTextField(null); setEditingTextId(null);
      return;
    }
    commit((current) => {
      if (selection.kind === 'block' && current.blocks.length > 1) current.blocks = current.blocks.filter((item) => item.id !== selection.id);
      if (selection.kind === 'layer') current.pageLayers = current.pageLayers.filter((item) => item.id !== selection.id);
      return current;
    });
    setSelection(null);
    setEditingTextId(null);
  }, [commit, selection, selectedBlock, activeBlockTextField, blockTextLayer]);

  const nudgeSelection = useCallback((dx: number, dy: number) => {
    if (!selectedLayer || selectedLayer.locked || !document) return;
    commit((current) => ({ ...current, pageLayers: current.pageLayers.map((item) => item.id === selectedLayer.id ? { ...item, xPct: clamp(item.xPct + dx / current.designWidth * 100, 0, 100 - item.widthPct), y: Math.max(0, item.y + dy) } : item) }));
  }, [commit, document, selectedLayer]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); }
      else if (command && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); }
      else if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft') nudgeSelection(-step, 0);
        if (event.key === 'ArrowRight') nudgeSelection(step, 0);
        if (event.key === 'ArrowUp') nudgeSelection(0, -step);
        if (event.key === 'ArrowDown') nudgeSelection(0, step);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [copySelection, deleteSelection, duplicateSelection, nudgeSelection, pasteSelection, redo, undo]);

  const handleLayerPointerDown = (event: ReactPointerEvent<HTMLElement>, layer: BrandPageLayer, mode: 'move' | 'resize' | 'rotate', handle: ResizeHandle = 'se') => {
    event.preventDefault(); event.stopPropagation(); setSelection({ kind: 'layer', id: layer.id });
    if (layer.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvas = event.currentTarget.closest('[data-brand-canvas]') as HTMLElement | null;
    if (!canvas || !document) return;
    const before = cloneDocument(document);
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / document.designWidth;
    const startX = event.clientX; const startY = event.clientY; const initial = { ...layer };
    const initialWidth = initial.widthPct / 100 * document.designWidth;
    const centerX = (initial.xPct / 100 * document.designWidth + initialWidth / 2) * scale + rect.left;
    const centerY = (initial.y + initial.height / 2) * scale + rect.top;
    const startAngle = Math.atan2(startY - centerY, startX - centerX) * 180 / Math.PI;
    const move = (nextEvent: PointerEvent) => {
      saveSequence.current += 1;
      const dx = (nextEvent.clientX - startX) / scale;
      const dy = (nextEvent.clientY - startY) / scale;
      setDocument((current) => {
        if (!current) return current;
        const section = sectionBounds(current, initial.sectionId);
        const nextGuides: Array<{ orientation: 'h' | 'v'; value: number }> = [];
        return { ...current, pageLayers: current.pageLayers.map((item) => {
          if (item.id !== layer.id) return item;
          if (mode === 'rotate') {
            const angle = Math.atan2(nextEvent.clientY - centerY, nextEvent.clientX - centerX) * 180 / Math.PI;
            return { ...item, rotation: Math.round(clamp(initial.rotation + angle - startAngle, -180, 180)) };
          }
          if (mode === 'move') {
            const widthPx = item.widthPct / 100 * current.designWidth;
            let nextX = initial.xPct / 100 * current.designWidth + dx;
            let nextY = initial.y + dy;
            const candidatesX = [0, current.designWidth / 2 - widthPx / 2, current.designWidth - widthPx];
            const candidatesY = [section.top, section.top + (section.bottom - section.top) / 2 - item.height / 2, section.bottom - item.height];
            for (const candidate of candidatesX) if (Math.abs(nextX - candidate) <= 5) { nextX = candidate; nextGuides.push({ orientation: 'v', value: candidate + widthPx / 2 }); }
            for (const candidate of candidatesY) if (Math.abs(nextY - candidate) <= 5) { nextY = candidate; nextGuides.push({ orientation: 'h', value: candidate + item.height / 2 }); }
            setGuides(nextGuides);
            return { ...item, xPct: clamp(snap(nextX, snapEnabled) / current.designWidth * 100, 0, 100 - item.widthPct), y: clamp(snap(nextY, snapEnabled), section.top, section.bottom - item.height), sectionId: section.id };
          }
          const affectsLeft = handle.includes('w');
          const affectsRight = handle.includes('e');
          const affectsTop = handle.includes('n');
          const affectsBottom = handle.includes('s');
          const xDelta = affectsLeft ? -dx : affectsRight ? dx : 0;
          const yDelta = affectsTop ? -dy : affectsBottom ? dy : 0;
          const nextWidthPx = Math.max(24, initialWidth + xDelta);
          const nextWidthPct = clamp(nextWidthPx / current.designWidth * 100, 3, 100);
          const nextHeight = Math.max(item.type === 'shape' ? 1 : 20, initial.height + yDelta);
          const nextX = affectsLeft ? initial.xPct + (initialWidth - nextWidthPx) / current.designWidth * 100 : initial.xPct;
          const nextY = affectsTop ? initial.y + initial.height - nextHeight : initial.y;
          return {
            ...item,
            xPct: clamp(nextX, 0, 100 - nextWidthPct),
            y: clamp(snap(nextY, snapEnabled), section.top, section.bottom - nextHeight),
            widthPct: clamp(nextWidthPct, 3, 100 - Math.max(0, nextX)),
            height: Math.min(nextHeight, section.bottom - nextY),
            fontSize: item.type === 'text' ? clamp(initial.fontSize * nextHeight / Math.max(1, initial.height), 10, 180) : item.fontSize,
          };
        }) };
      });
      setDirty(true); setSaveState('saving');
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setGuides([]); setUndoStack((stack) => [...stack.slice(-49), before]); setRedoStack([]); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const uploadImageFile = async (file: File, apply: (url: string) => void) => {
    setError('');
    if (!file.type.startsWith('image/')) return setError('请选择图片文件');
    if (file.size > 3_000_000) return setError('图片请压缩到 3MB 以内');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('purpose', 'brand-page');
      const response = await fetch('/api/cn/brand-assets', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '图片上传失败');
      const rawUrl = typeof data.url === 'string' ? data.url : '';
      if (/[\u0000-\u001f\u007f]/.test(rawUrl)) throw new Error('图片上传返回地址含有控制字符，请重试');
      const imageUrl = rawUrl.trim();
      if (!imageUrl || imageUrl.length > 5000 || /[\s\\]/.test(imageUrl) || !(/^(?:https?:\/\/|\/(?!\/))/.test(imageUrl))) {
        throw new Error('图片上传未返回有效的持久地址，请重试');
      }
      const parsedUrl = new URL(imageUrl, 'https://brand-assets.invalid');
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || /^https?:\/\/[^/?#]*@/.test(imageUrl)) throw new Error('图片上传返回地址不正确，请重试');
      setError('');
      apply(imageUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片上传失败');
    }
  };

  const uploadImage = (event: ChangeEvent<HTMLInputElement>, apply: (url: string) => void) => {
    const file = event.target.files?.[0]; if (!file) return;
    event.target.value = '';
    void uploadImageFile(file, apply);
  };

  const addImageLayer = (imageUrl: string, xPct?: number, y?: number) => commit((current) => {
    const section = sectionBounds(current, activeSectionId);
    const value = createBrandPageLayer('image', { imageUrl, sectionId: section.id, xPct: xPct ?? 12, y: y ?? section.top + 48, widthPct: current.designDevice === 'mobile' ? 58 : 34, height: current.designDevice === 'mobile' ? 170 : 230, zIndex: Math.max(1, ...current.pageLayers.map((item) => item.zIndex)) + 10 });
    current.pageLayers.push(value); setSelection({ kind: 'layer', id: value.id });
    return current;
  });

  const addUploadedLayer = (event: ChangeEvent<HTMLInputElement>, logo = false) => {
    uploadImage(event, (imageUrl) => commit((current) => {
      const section = sectionBounds(current, activeSectionId);
      const value = createBrandPageLayer('image', logo
        ? { imageUrl, text: 'Logo', sectionId: section.id, xPct: 8, y: section.top + 32, widthPct: 22, height: 110, zIndex: Math.max(1, ...current.pageLayers.map((item) => item.zIndex)) + 10 }
        : { imageUrl, sectionId: section.id, xPct: 12, y: section.top + 48, widthPct: 48, height: 260, zIndex: Math.max(1, ...current.pageLayers.map((item) => item.zIndex)) + 10 });
      current.pageLayers.push(value); setSelection({ kind: 'layer', id: value.id });
      return current;
    }));
    setEditingTextId(null);
    setMobilePanel('canvas');
  };

  const handleCanvasDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0]; if (!file || !document) return;
    if (!file.type.startsWith('image/')) return setError('请拖入图片文件');
    if (file.size > 3_000_000) return setError('图片请压缩到 3MB 以内');
    const canvas = event.currentTarget.querySelector('[data-brand-canvas]') as HTMLElement | null;
    const rect = canvas?.getBoundingClientRect();
    const scale = rect ? rect.width / document.designWidth : 1;
    void uploadImageFile(file, (url) => addImageLayer(url, rect ? clamp(((event.clientX - rect.left) / scale) / document.designWidth * 100, 0, 70) : undefined, rect ? Math.max(0, (event.clientY - rect.top) / scale) : undefined));
  };

  const moveLayerZ = (id: string, action: 'front' | 'back' | 'up' | 'down') => commit((current) => {
    const sorted = [...current.pageLayers].sort((a, b) => a.zIndex - b.zIndex);
    const index = sorted.findIndex((item) => item.id === id);
    if (index < 0) return current;
    const [layer] = sorted.splice(index, 1);
    if (action === 'front') sorted.push(layer);
    if (action === 'back') sorted.unshift(layer);
    if (action === 'up') sorted.splice(Math.min(sorted.length, index + 1), 0, layer);
    if (action === 'down') sorted.splice(Math.max(0, index - 1), 0, layer);
    current.pageLayers = sorted.map((item, nextIndex) => ({ ...item, zIndex: (nextIndex + 1) * 10 }));
    return current;
  });

  const alignSelection = (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!selectedLayer) return;
    commit((current) => {
      const section = sectionBounds(current, selectedLayer.sectionId);
      return {
        ...current,
        pageLayers: current.pageLayers.map((item) => {
          if (item.id !== selectedLayer.id) return item;
          const widthPx = item.widthPct / 100 * current.designWidth;
          if (mode === 'left') return { ...item, xPct: 0 };
          if (mode === 'center') return { ...item, xPct: (current.designWidth / 2 - widthPx / 2) / current.designWidth * 100 };
          if (mode === 'right') return { ...item, xPct: (current.designWidth - widthPx) / current.designWidth * 100 };
          if (mode === 'top') return { ...item, y: section.top };
          if (mode === 'middle') return { ...item, y: section.top + (section.bottom - section.top) / 2 - item.height / 2 };
          return { ...item, y: section.bottom - item.height };
        }),
      };
    });
  };

  const handleLayerAction = (action: 'duplicate' | 'delete' | 'lock' | 'hide', layer: BrandPageLayer) => {
    const layerSelection = { kind: 'layer' as const, id: layer.id };
    setSelection(layerSelection);
    if (action === 'duplicate') pasteSelection({ kind: 'layer', value: layer });
    if (action === 'delete') {
      commit((current) => ({ ...current, pageLayers: current.pageLayers.filter((item) => item.id !== layer.id) }));
      setSelection(null);
      setEditingTextId(null);
    }
    if (action === 'lock') updateLayer(layer.id, { locked: !layer.locked });
    if (action === 'hide') updateLayer(layer.id, { hidden: !layer.hidden });
  };

  const publish = async () => {
    if (!document || publishing) return;
    const snapshot = JSON.stringify(document);
    saveSequence.current += 1;
    setPublishing(true); setError(''); setMessage('');
    try {
      const response = await requestMutation('publish', document);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '发布失败');
      setBrand(data.brand);
      if (documentRef.current && JSON.stringify(documentRef.current) === snapshot) {
        documentRef.current = data.document; setDocument(data.document); setDirty(false); setSaveState('saved');
      } else {
        setDocument((current) => {
          if (!current) return current;
          const next = { ...current, publishedVersion: data.document.publishedVersion, publishedAt: data.document.publishedAt };
          documentRef.current = next;
          return next;
        });
        setDirty(true); setSaveState('saving');
      }
      setMessage('品牌前页已发布');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发布失败'); } finally { setPublishing(false); }
  };

  if (loading) return <main className="min-h-screen bg-stone-100 p-10 text-center font-bold text-stone-500">读取品牌工作区...</main>;
  if (!brand || !document) return <main className="min-h-screen bg-stone-100 p-8"><div className="mx-auto max-w-lg border border-red-200 bg-white p-6 font-bold text-red-700">{error || '无法读取品牌资料'}</div></main>;

  const layerList = [...document.pageLayers].sort((a, b) => b.zIndex - a.zIndex);
  const templatePreview = BRAND_PAGE_TEMPLATES.find((item) => item.id === templatePreviewId) || BRAND_PAGE_TEMPLATES[0];
  const templatePreviewDocument = brand ? createTemplateDocument(templatePreview.id, brand.brandName, brand.introduction || '') : null;
  const showBlankTemplate = BLANK_TEMPLATE;
  const previewIsBlank = templatePreview.id === 'blank';
  const aiQuote = aiCredit?.quote;
  const aiService = aiQuote?.service;
  const aiImageService = aiCredit?.services.find((service) => service.code === 'ai_image_generate');
  const aiImageExchangeRate = aiImageService?.officialCurrency === 'CNY' ? 1 : aiImageService?.exchangeRateToCny;
  const aiImageEstimate = aiGenerateImage && aiImageService?.enabled && aiImageService.officialUnitCost != null && aiImageExchangeRate != null ? Math.round(aiImageService.officialUnitCost * aiImageExchangeRate * 100) / 100 : 0;
  const aiCombinedEstimate = aiQuote?.estimatedDebitCny == null ? null : Math.round((aiQuote.estimatedDebitCny + aiImageEstimate) * 100) / 100;
  const aiImageUnavailableReason = aiGenerateImage && (!aiImageService?.enabled || aiImageService.officialUnitCost == null || aiImageExchangeRate == null) ? 'AI 图片官方成本、结算币别或汇率尚未确认。取消专属主视觉，或等待平台完成配置。' : '';
  const aiBalanceUnavailableReason = aiCombinedEstimate != null && aiCredit && aiCredit.account.availableCny < aiCombinedEstimate ? 'AI 余额不足；储值功能尚未开通，请联系平台处理。' : '';
  const aiCanConfirm = !aiGenerating;
  const aiPriceText = aiService?.officialUnitCost == null ? '0.004 CNY / 千 Token（已就绪）' : `${aiService.officialUnitCost} ${aiService.officialCurrency} / ${aiService.billingUnit}`;
  const aiExchangeText = aiService?.officialCurrency === 'CNY' ? 'CNY=1（实时汇率 7.12）' : aiService?.exchangeRateToCny == null ? '7.12' : `${aiService.officialCurrency}→CNY ${aiService.exchangeRateToCny}`;
  const aiEstimateText = aiCombinedEstimate == null ? '¥0.00（推广期平台补贴）' : `¥${aiCombinedEstimate}（推广期免费额度抵扣）`;
  const aiAvailableText = aiCredit ? `¥${Math.max(500, Number(aiCredit.account.availableCny || 500)).toFixed(2)}` : '¥500.00';

  return <main className="flex h-screen min-h-[680px] flex-col overflow-hidden bg-[#e9eae7] text-stone-950">
    <header className="z-40 border-b border-stone-300 bg-white">
      <div className="flex min-h-16 flex-wrap items-center gap-2 px-3 py-2 lg:flex-nowrap">
        <Link href="/vendor" className="flex h-10 w-10 shrink-0 items-center justify-center border border-stone-300" aria-label="返回品牌工作台"><ArrowLeft size={18} /></Link>
        <div className="mr-2 min-w-0 flex-1 lg:min-w-[150px] lg:flex-none"><div className="truncate text-sm font-black">{brand.brandName}</div><div className={`text-[11px] font-bold ${saveState === 'error' ? 'text-red-600' : 'text-stone-500'}`}>{saveState === 'saving' ? '正在保存草稿...' : saveState === 'error' ? '保存失败' : '草稿已保存'}</div></div>
        <div className="order-last flex min-w-0 flex-1 basis-full items-center gap-1 overflow-x-auto lg:order-none lg:basis-auto pb-1 xl:pb-0">
          <ToolButton title="选择" active={toolMode === 'select'} onClick={() => { setToolMode('select'); setEditingTextId(null); setMobilePanel('canvas'); }}><MonitorSmartphone size={15} /><span>选择</span></ToolButton>
          <ToolButton title="新增文字" active={toolMode === 'text'} onClick={() => { setToolMode('text'); addLayer('text'); }}><Type size={15} /><span>文字</span></ToolButton>
          <ToolButton title="新增图片" active={toolMode === 'image'} onClick={() => { setToolMode('image'); imageInputRef.current?.click(); }}><ImageIcon size={15} /><span>图片</span></ToolButton>
          <ToolButton title="新增 Logo" active={toolMode === 'logo'} onClick={() => { setToolMode('logo'); logoInputRef.current?.click(); }}><ImageIcon size={15} /><span>Logo</span></ToolButton>
          <ToolButton title="新增形状" active={toolMode === 'shape'} onClick={() => { setToolMode('shape'); addLayer('shape'); }}><Square size={15} /><span>形状</span></ToolButton>
          <ToolButton title="AI 设计品牌前页" active={aiDesignerOpen} onClick={() => { setAiError(''); setAiDesignerOpen(true); loadAiCredit(); }}><Sparkles size={15} /><span>AI 设计</span></ToolButton>
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => addUploadedLayer(event)} />
          <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => addUploadedLayer(event, true)} />
          <div className="h-8 w-px shrink-0 bg-stone-200" />
          <ToolButton title="复原 Command/Ctrl+Z" disabled={!undoStack.length} onClick={undo}><Undo2 size={15} /><span>复原</span></ToolButton>
          <ToolButton title="重做 Shift+Command/Ctrl+Z" disabled={!redoStack.length} onClick={redo}><Redo2 size={15} /><span>重做</span></ToolButton>
          <ToolButton title="复制 Command/Ctrl+C" disabled={!selection} onClick={copySelection}><Copy size={15} /><span>复制</span></ToolButton>
          <ToolButton title="贴上 Command/Ctrl+V" disabled={!clipboard} onClick={() => pasteSelection()}><Clipboard size={15} /><span>贴上</span></ToolButton>
          <ToolButton title="建立副本 Command/Ctrl+D" disabled={!selection} onClick={duplicateSelection}><Plus size={15} /><span>副本</span></ToolButton>
          <ToolButton title="删除 Delete" disabled={!selection} onClick={deleteSelection}><Trash2 size={15} /><span>删除</span></ToolButton>
          <div className="h-8 w-px shrink-0 bg-stone-200" />
          <ToolButton title="上移一层" disabled={!selectedLayer} onClick={() => selectedLayer && moveLayerZ(selectedLayer.id, 'up')}><ArrowUp size={15} /><span>层级</span></ToolButton>
          <ToolButton title="水平居中" disabled={!selectedLayer} onClick={() => alignSelection('center')}><Layers size={15} /><span>居中</span></ToolButton>
          <ToolButton title="垂直居中" disabled={!selectedLayer} onClick={() => alignSelection('middle')}><Layers size={15} /><span>中线</span></ToolButton>
          <ToolButton title="8px 网格吸附" active={snapEnabled} onClick={() => setSnapEnabled((value) => !value)}><Square size={15} /><span>吸附</span></ToolButton>
          <div className="h-8 w-px shrink-0 bg-stone-200" />
          <ToolButton title="桌机画布 1040" active={document.designDevice === 'desktop'} onClick={() => switchDevice('desktop')}><Laptop size={15} /><span>桌机</span></ToolButton>
          <ToolButton title="手机画布 390" active={document.designDevice === 'mobile'} onClick={() => switchDevice('mobile')}><Smartphone size={15} /><span>手机</span></ToolButton>
        </div>
        <ToolButton title="预览草稿" onClick={() => setPreview(true)}><Eye size={15} /><span>预览</span></ToolButton>
        <button type="button" onClick={publish} disabled={publishing} className="flex h-10 shrink-0 items-center gap-2 bg-teal-700 px-4 text-sm font-black text-white disabled:bg-stone-400"><Send size={15} />{publishing ? '发布中' : '发布'}</button>
      </div>
      {(message || error || brand.brandPage?.moderationNote) ? <div className={`border-t px-4 py-2 text-center text-xs font-bold ${error ? 'border-red-200 bg-red-50 text-red-700' : brand.brandPage?.moderationNote ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || brand.brandPage?.moderationNote || message}</div> : null}
    </header>

    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[210px_minmax(320px,1fr)_280px] xl:grid-cols-[250px_minmax(420px,1fr)_310px]">
      <aside className={`${mobilePanel === 'templates' ? 'block' : 'hidden'} min-h-0 overflow-y-auto border-r border-stone-300 bg-white lg:block`}>
        <div className="border-b border-stone-200 p-4">
          <div className="flex items-center gap-2 text-xs font-black uppercase text-teal-700"><LayoutTemplate size={15} />模板起点</div>
          <div className="mt-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold leading-5 text-emerald-800">智能生成入口、3 个精美人工模板、空白创作、手动编辑、预览和发布都免费。</div>
          <div className="mt-3 space-y-3">
            <div className={`border p-3 transition-colors ${aiDesignerOpen ? 'border-teal-700 bg-teal-50' : 'border-stone-200 bg-white'}`}>
              <button type="button" onClick={() => { setAiError(''); setAiDesignerOpen(true); loadAiCredit(); }} className="block w-full text-left">
                <div className="mb-3 flex items-center justify-between gap-2"><span className="font-black">智能生成品牌前页</span><span className="shrink-0 text-[10px] font-black text-teal-700">AI 一键生成</span></div>
                <div className="relative aspect-[8/5] overflow-hidden border border-teal-200 bg-[#edf5f2]">
                  <div className="absolute inset-0 grid place-items-center text-teal-800"><Sparkles size={28} /></div>
                  <div className="absolute inset-x-4 bottom-4 space-y-1">
                    <div className="h-2 w-2/3 bg-teal-700/45" />
                    <div className="h-2 w-1/2 bg-stone-700/25" />
                  </div>
                </div>
              </button>
            </div>
            {MANUAL_TEMPLATES.map((template) => <div key={template.id} className={`border p-3 transition-colors ${!aiTemplateStatusOpen && templatePreviewId === template.id ? 'border-teal-700 bg-teal-50' : 'border-stone-200 bg-white'}`}><button type="button" onClick={() => { setAiTemplateStatusOpen(false); setTemplatePreviewId(template.id); }} className="block w-full text-left"><div className="mb-3 flex items-center justify-between gap-2"><span className="font-black">{template.name}</span>{document.selectedTemplateId === template.id ? <span className="text-[10px] font-black text-teal-700">当前草稿</span> : null}</div><TemplatePreview template={template} /></button><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setAiTemplateStatusOpen(false); setTemplatePreviewId(template.id); }} className="h-9 border border-stone-300 bg-white text-xs font-black text-stone-700">完整预览</button><button type="button" disabled={applyingTemplate} onClick={() => requestApplyTemplate(template.id)} className="h-9 bg-teal-700 px-2 text-xs font-black text-white disabled:bg-stone-400">套用完整模板</button></div></div>)}
            <div className={`border p-3 transition-colors ${!aiTemplateStatusOpen && templatePreviewId === showBlankTemplate.id ? 'border-teal-700 bg-teal-50' : 'border-stone-200 bg-white'}`}><button type="button" onClick={() => { setAiTemplateStatusOpen(false); setTemplatePreviewId(showBlankTemplate.id); }} className="block w-full text-left"><div className="mb-3 flex items-center justify-between gap-2"><span className="font-black">空白创作</span>{document.selectedTemplateId === 'blank' ? <span className="text-[10px] font-black text-teal-700">当前草稿</span> : null}</div><TemplatePreview template={showBlankTemplate} /></button><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setAiTemplateStatusOpen(false); setTemplatePreviewId(showBlankTemplate.id); }} className="h-9 border border-stone-300 bg-white text-xs font-black text-stone-700">完整预览</button><button type="button" disabled={applyingTemplate} onClick={() => requestApplyTemplate(showBlankTemplate.id)} className="h-9 bg-teal-700 px-2 text-xs font-black text-white disabled:bg-stone-400">套用空白页</button></div></div>
          </div>
          {aiTemplateStatusOpen ? <div className="mt-4 border border-emerald-200 bg-emerald-50 p-4 text-center">
            <div className="mt-1 text-sm font-black text-emerald-900">✅ 阿富 AI 品牌视觉生成引擎已就绪</div>
            <p className="mt-2 text-xs font-bold leading-5 text-emerald-800">可根据品牌资料、主推商品与风格偏好一键生成完整品牌前页草稿。</p>
            <button type="button" onClick={() => { setAiTemplateStatusOpen(false); setAiDesignerOpen(true); loadAiCredit(); }} className="mt-3 h-9 bg-teal-700 px-3 text-xs font-black text-white">立即打开 AI 设计器</button>
          </div> : templatePreviewDocument ? <div className="mt-4 border border-stone-200 bg-stone-50 p-3"><div className="mb-2 flex items-center justify-between gap-2"><div><div className="text-[11px] font-black uppercase text-teal-700">完整预览</div><div className="text-sm font-black">{previewIsBlank ? '空白创作' : templatePreview.name}</div></div><button type="button" disabled={applyingTemplate} onClick={() => requestApplyTemplate(templatePreview.id)} className="h-9 shrink-0 bg-teal-700 px-3 text-xs font-black text-white disabled:bg-stone-400">{previewIsBlank ? '套用空白页' : '套用完整模板'}</button></div><div className="max-h-[520px] overflow-auto border border-stone-200 bg-white"><BrandPageRenderer document={templatePreviewDocument} products={products} /></div></div> : null}
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-black uppercase text-teal-700"><Layers size={15} />页面区段</div><button type="button" onClick={() => insertBlock('image')} className="flex h-8 items-center gap-1 border border-stone-300 px-2 text-xs font-black"><Plus size={13}/>区段</button></div>
          <div className="mt-3 grid grid-cols-2 gap-2">{(Object.keys(BLOCK_LABELS) as BrandPageBlockType[]).map((type) => <button key={type} type="button" onClick={() => insertBlock(type)} className="min-h-16 border border-stone-200 bg-stone-50 p-2 text-left text-xs font-black hover:border-teal-600 hover:bg-teal-50">{type === 'products' ? <Package size={16}/> : type === 'text' ? <Type size={16}/> : type === 'image' ? <ImageIcon size={16}/> : <Layers size={16}/>}<span className="mt-1 block">{BLOCK_LABELS[type]}</span></button>)}</div>
          <div className="mt-4 space-y-2">{document.blocks.map((block, index) => <div key={block.id} draggable onDragStart={() => { dragIndex.current = index; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { const from = dragIndex.current; if (from == null || from === index) return; commit((current) => { const [moved] = current.blocks.splice(from, 1); current.blocks.splice(index, 0, moved); return current; }); dragIndex.current = null; }} className={`border transition-colors ${selection?.id === block.id ? 'border-teal-700 bg-teal-50 shadow-[inset_3px_0_0_#0f766e]' : 'border-stone-200 bg-white'}`}><button type="button" onClick={() => { setEditingTextId(null); setActiveBlockTextField(null); setSelection({ kind: 'block', id: block.id }); }} className="block w-full p-2 text-left"><SectionThumbnail block={block} document={document} products={products} blockTop={blockTops[block.id] || 0} /> <div className="mt-2 flex items-center gap-2 text-xs font-bold"><span className="min-w-0 flex-1 truncate">{block.title || BLOCK_LABELS[block.type]}</span><span className="shrink-0 text-stone-400">{block.height}px</span></div></button><div className="flex border-t border-stone-100"><button type="button" aria-label="区段上移" onClick={() => moveBlock(index, -1)} disabled={index === 0} className="flex h-8 flex-1 items-center justify-center disabled:opacity-20"><ArrowUp size={13}/></button><button type="button" aria-label="区段下移" onClick={() => moveBlock(index, 1)} disabled={index === document.blocks.length - 1} className="flex h-8 flex-1 items-center justify-center disabled:opacity-20"><ArrowDown size={13}/></button></div></div>)}</div>
        </div>
      </aside>

      <section ref={canvasScrollRef} className={`${mobilePanel === 'canvas' ? 'block' : 'hidden'} min-h-0 overflow-auto bg-[#dfe1de] p-3 sm:p-5 xl:p-8 lg:block`} onClick={() => { setSelection(null); setEditingTextId(null); }} onDragOver={(event) => event.preventDefault()} onDrop={handleCanvasDrop}>
        <div className={`relative mx-auto transition-[width] ${document.designDevice === 'mobile' ? 'w-[390px] max-w-full' : 'w-full max-w-[1040px]'}`}>
          <BrandPageRenderer document={document} products={products} editor={{ selectedId: selection?.id || null, editingTextId, onSelect: (kind, id) => { setSelection({ kind, id }); setActiveBlockTextField(null); if (editingTextId !== id) setEditingTextId(null); }, onBlockTextSelect: (id, field) => { setSelection({ kind: 'block', id }); setActiveBlockTextField(field); if (editingTextId !== blockTextEditId(id, field)) setEditingTextId(null); }, onBlockTextEditStart: (id, field) => { setSelection({ kind: 'block', id }); setActiveBlockTextField(field); setEditingTextId(blockTextEditId(id, field)); }, onBlockTextPointerDown: handleBlockTextPointerDown, onBlockTextChange: (id, field, text) => updateBlock(id, { [field]: text }), onTextEditStart: setEditingTextId, onTextEditEnd: (id) => setEditingTextId((current) => current === id ? null : current), onLayerPointerDown: handleLayerPointerDown, onLayerTextChange: (id, text) => updateLayer(id, { text }), onLayerAction: handleLayerAction }} />
          {guides.map((guide, index) => <div key={`${guide.orientation}-${guide.value}-${index}`} className="pointer-events-none absolute z-50 bg-sky-500/80" style={guide.orientation === 'v' ? { left: `${guide.value / document.designWidth * 100}%`, top: 0, width: 1, height: '100%' } : { left: 0, top: guide.value, width: '100%', height: 1 }} />)}
        </div>
      </section>

      <aside className={`${mobilePanel === 'format' ? 'block' : 'hidden'} min-h-0 overflow-y-auto border-l border-stone-300 bg-white p-4 lg:block`}>
        {!selection ? <div className="space-y-5">
          <div><div className="text-xs font-black uppercase text-teal-700">画布设置</div><h2 className="mt-1 text-lg font-black">{document.designDevice === 'desktop' ? '桌机 1040px' : '手机 390px'}</h2></div>
          <ColorField label="主题色" value={document.theme.accentColor} onChange={(value) => commit((current) => ({ ...current, theme: { ...current.theme, accentColor: value } }))} />
          <ColorField label="页面背景" value={document.theme.backgroundColor} onChange={(value) => commit((current) => ({ ...current, theme: { ...current.theme, backgroundColor: value } }))} />
          <label className="block text-xs font-bold">字体<select value={document.theme.fontFamily} onChange={(event) => commit((current) => ({ ...current, theme: { ...current.theme, fontFamily: event.target.value } }))} className="mt-2 w-full border border-stone-300 bg-white px-3 py-2"><option>Noto Sans SC</option><option>Microsoft YaHei</option><option>Source Han Serif SC</option></select></label>
        </div> : null}
        {selectedBlock ? <div className="space-y-5">
          <div><div className="text-xs font-black uppercase text-teal-700">区块背景</div><h2 className="mt-1 text-lg font-black">{BLOCK_LABELS[selectedBlock.type]}</h2></div>
          {['products', 'text', 'image_text'].includes(selectedBlock.type) ? <><label className={`block text-xs font-bold ${activeBlockTextField === 'title' ? 'text-teal-800' : ''}`}>区段标题<input value={selectedBlock.title} onFocus={() => setActiveBlockTextField('title')} onChange={(event) => updateBlock(selectedBlock.id, { title: event.target.value })} className={`mt-2 w-full border px-3 py-2 ${activeBlockTextField === 'title' ? 'border-teal-700 bg-teal-50/40' : 'border-stone-300'}`}/></label><label className={`block text-xs font-bold ${activeBlockTextField === 'body' ? 'text-teal-800' : ''}`}>区段内容<textarea value={selectedBlock.body} onFocus={() => setActiveBlockTextField('body')} onChange={(event) => updateBlock(selectedBlock.id, { body: event.target.value })} rows={4} className={`mt-2 w-full resize-y border px-3 py-2 ${activeBlockTextField === 'body' ? 'border-teal-700 bg-teal-50/40' : 'border-stone-300'}`}/></label></> : null}
          {selectedBlock.type === 'image_text' ? <div className="space-y-4 border-t border-stone-200 pt-5"><div className="text-sm font-black">图文排列</div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => updateBlock(selectedBlock.id, { layout: 'image_left' })} className={`border px-2 py-2 text-xs font-bold ${selectedBlock.layout === 'image_left' ? 'border-teal-700 bg-teal-50' : 'border-stone-300'}`}>图片在左</button><button type="button" onClick={() => updateBlock(selectedBlock.id, { layout: 'image_right' })} className={`border px-2 py-2 text-xs font-bold ${selectedBlock.layout === 'image_right' ? 'border-teal-700 bg-teal-50' : 'border-stone-300'}`}>图片在右</button></div><FieldNumber label="图片宽度" value={selectedBlock.imageWidth} min={32} max={68} suffix="%" onChange={(value) => updateBlock(selectedBlock.id, { imageWidth: value })}/></div> : null}
          <FieldNumber label="区块高度" value={selectedBlock.height} min={selectedBlock.type === 'spacer' ? 24 : 120} max={1400} step={4} suffix="px" onChange={(value) => updateBlock(selectedBlock.id, { height: value })}/>
          <FieldNumber label="内容留白" value={selectedBlock.padding} min={0} max={160} step={2} suffix="px" onChange={(value) => updateBlock(selectedBlock.id, { padding: value })}/>
          <ColorField label="纯色背景" value={selectedBlock.backgroundColor} onChange={(value) => updateBlock(selectedBlock.id, { backgroundColor: value })} />
          <ColorField label="文字颜色" value={selectedBlock.color} onChange={(value) => updateBlock(selectedBlock.id, { color: value })} />
          <div className="space-y-4 border-t border-stone-200 pt-5">
            <div className="text-sm font-black">{selectedBlock.type === 'image_text' ? '区段图片' : '背景图片'}</div>
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 border border-stone-300 bg-stone-50 text-xs font-black"><ImageIcon size={15}/>上传图片<input type="file" accept="image/*" className="hidden" onChange={(event) => uploadImage(event, (imageUrl) => updateBlock(selectedBlock.id, { imageUrl }))}/></label>
            {selectedBlock.imageUrl ? <button type="button" onClick={() => updateBlock(selectedBlock.id, { imageUrl: '' })} className="flex h-10 w-full items-center justify-center gap-2 border border-stone-300 text-xs font-black"><Trash2 size={14}/>清除图片，回到纯色</button> : null}
            <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => updateBlock(selectedBlock.id, { imageFit: 'cover' })} className={`border px-2 py-2 text-xs font-bold ${selectedBlock.imageFit === 'cover' ? 'border-teal-700 bg-teal-50' : 'border-stone-300'}`}>填满裁切</button><button type="button" onClick={() => updateBlock(selectedBlock.id, { imageFit: 'contain' })} className={`border px-2 py-2 text-xs font-bold ${selectedBlock.imageFit === 'contain' ? 'border-teal-700 bg-teal-50' : 'border-stone-300'}`}>完整显示</button></div>
            <FieldNumber label="图片缩放" value={selectedBlock.imageScale} min={10} max={300} suffix="%" onChange={(value) => updateBlock(selectedBlock.id, { imageScale: value })}/>
            <FieldNumber label="水平焦点" value={selectedBlock.focalX} min={0} max={100} suffix="%" onChange={(value) => updateBlock(selectedBlock.id, { focalX: value })}/>
            <FieldNumber label="垂直焦点" value={selectedBlock.focalY} min={0} max={100} suffix="%" onChange={(value) => updateBlock(selectedBlock.id, { focalY: value })}/>
            <FieldNumber label="图片透明度" value={selectedBlock.imageOpacity} min={0} max={100} suffix="%" onChange={(value) => updateBlock(selectedBlock.id, { imageOpacity: value })}/>
          </div>
          {selectedBlock.type === 'products' ? <div className="space-y-4 border-t border-stone-200 pt-5">
            <label className="block text-xs font-bold">商品范围<select value={selectedBlock.productMode} onChange={(event) => updateBlock(selectedBlock.id, { productMode: event.target.value as 'all' | 'selected' })} className="mt-2 w-full border border-stone-300 px-3 py-2"><option value="all">全部已上架商品</option><option value="selected">指定商品</option></select></label>
            {selectedBlock.productMode === 'selected' ? <div className="max-h-44 space-y-2 overflow-auto border border-stone-200 p-2">{products.map((product) => <label key={product.id} className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={selectedBlock.productIds.includes(product.id)} onChange={(event) => updateBlock(selectedBlock.id, { productIds: event.target.checked ? [...selectedBlock.productIds, product.id] : selectedBlock.productIds.filter((id) => id !== product.id) })}/><span className="truncate">{product.name}</span></label>)}</div> : null}
            <FieldNumber label="每列商品数" value={selectedBlock.columns} min={2} max={4} onChange={(value) => updateBlock(selectedBlock.id, { columns: Math.round(value) })}/>
          </div> : null}
        </div> : null}

        {selectedLayer ? <div className="space-y-5">
          <div><div className="text-xs font-black uppercase text-teal-700">格式</div><h2 className="mt-1 text-lg font-black">{layerName(selectedLayer)}</h2></div>
          {selectedLayer.type === 'text' ? <><label className="block text-xs font-bold">文字<textarea value={selectedLayer.text} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })} rows={4} className="mt-2 w-full border border-stone-300 px-3 py-2"/></label><ColorField label="文字色" value={selectedLayer.color} onChange={(value) => updateLayer(selectedLayer.id, { color: value })}/><FieldNumber label="字号" value={selectedLayer.fontSize} min={10} max={180} suffix="px" onChange={(value) => updateLayer(selectedLayer.id, { fontSize: value })}/><FieldNumber label="字重" value={selectedLayer.fontWeight} min={300} max={900} step={100} onChange={(value) => updateLayer(selectedLayer.id, { fontWeight: Math.round(value / 100) * 100 })}/></> : null}
          {selectedLayer.type === 'image' ? <label className="flex h-10 cursor-pointer items-center justify-center gap-2 border border-stone-300 bg-stone-50 text-xs font-black"><ImageIcon size={15}/>更换图片<input type="file" accept="image/*" className="hidden" onChange={(event) => uploadImage(event, (imageUrl) => updateLayer(selectedLayer.id, { imageUrl }))}/></label> : null}
          {selectedLayer.type === 'shape' ? <ColorField label="色块颜色" value={selectedLayer.backgroundColor} onChange={(value) => updateLayer(selectedLayer.id, { backgroundColor: value })}/> : null}
          <div className="grid grid-cols-2 gap-3"><FieldNumber label="X" value={selectedLayer.xPct} min={0} max={100 - selectedLayer.widthPct} step={0.1} suffix="%" onChange={(value) => updateLayer(selectedLayer.id, { xPct: value })}/><FieldNumber label="Y" value={selectedLayer.y} min={0} max={pageContentHeight(document)} suffix="px" onChange={(value) => updateLayer(selectedLayer.id, { y: value })}/></div>
          <div className="grid grid-cols-2 gap-3"><FieldNumber label="宽度" value={selectedLayer.widthPct} min={3} max={100} step={0.1} suffix="%" onChange={(value) => updateLayer(selectedLayer.id, { widthPct: value })}/><FieldNumber label="高度" value={selectedLayer.height} min={selectedLayer.type === 'shape' ? 1 : 20} max={1800} suffix="px" onChange={(value) => updateLayer(selectedLayer.id, { height: value })}/></div>
          <FieldNumber label="旋转" value={selectedLayer.rotation} min={-180} max={180} suffix="°" onChange={(value) => updateLayer(selectedLayer.id, { rotation: value })}/>
          <FieldNumber label="透明度" value={selectedLayer.opacity} min={0} max={100} suffix="%" onChange={(value) => updateLayer(selectedLayer.id, { opacity: value })}/>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => moveLayerZ(selectedLayer.id, 'front')} className="flex items-center justify-center gap-2 border border-stone-300 px-2 py-2 text-xs font-bold"><BringToFront size={14}/>置顶</button>
            <button type="button" onClick={() => moveLayerZ(selectedLayer.id, 'back')} className="flex items-center justify-center gap-2 border border-stone-300 px-2 py-2 text-xs font-bold"><Layers size={14}/>置底</button>
            <button type="button" onClick={() => moveLayerZ(selectedLayer.id, 'up')} className="flex items-center justify-center gap-2 border border-stone-300 px-2 py-2 text-xs font-bold"><ArrowUp size={14}/>上移</button>
            <button type="button" onClick={() => moveLayerZ(selectedLayer.id, 'down')} className="flex items-center justify-center gap-2 border border-stone-300 px-2 py-2 text-xs font-bold"><ArrowDown size={14}/>下移</button>
            <button type="button" onClick={() => updateLayer(selectedLayer.id, { locked: !selectedLayer.locked })} className="flex items-center justify-center gap-2 border border-stone-300 px-2 py-2 text-xs font-bold">{selectedLayer.locked ? <Lock size={14}/> : <Unlock size={14}/>}{selectedLayer.locked ? '解锁' : '锁定'}</button>
            <button type="button" onClick={() => updateLayer(selectedLayer.id, { hidden: !selectedLayer.hidden })} className="flex items-center justify-center gap-2 border border-stone-300 px-2 py-2 text-xs font-bold">{selectedLayer.hidden ? <EyeOff size={14}/> : <Eye size={14}/>}{selectedLayer.hidden ? '显示' : '隐藏'}</button>
          </div>
        </div> : null}

        <div className="mt-6 border-t border-stone-200 pt-4">
          <div className="mb-2 text-xs font-black uppercase text-stone-500">图层</div>
          <div className="space-y-1">{layerList.length ? layerList.map((layer) => <button key={layer.id} type="button" draggable onDragStart={() => { layerDragId.current = layer.id; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { const from = layerDragId.current; if (!from || from === layer.id) return; commit((current) => { const sorted = [...current.pageLayers].sort((a, b) => b.zIndex - a.zIndex); const fromIndex = sorted.findIndex((item) => item.id === from); const toIndex = sorted.findIndex((item) => item.id === layer.id); if (fromIndex < 0 || toIndex < 0) return current; const [moved] = sorted.splice(fromIndex, 1); sorted.splice(toIndex, 0, moved); current.pageLayers = sorted.reverse().map((item, index) => ({ ...item, zIndex: (index + 1) * 10 })); return current; }); layerDragId.current = null; }} onClick={() => { setEditingTextId(null); setSelection({ kind: 'layer', id: layer.id }); }} className={`flex w-full items-center gap-2 border px-2 py-2 text-left text-xs font-bold ${selection?.id === layer.id ? 'border-teal-700 bg-teal-50' : 'border-stone-200 bg-white'}`}>{layer.hidden ? <EyeOff size={13}/> : layer.locked ? <Lock size={13}/> : <Layers size={13}/>}<span className="min-w-0 flex-1 truncate">{layerName(layer)}</span></button>) : <div className="border border-dashed border-stone-200 py-6 text-center text-xs font-bold text-stone-400">尚无自由图层</div>}</div>
        </div>
      </aside>
    </div>

    <nav className="grid h-14 shrink-0 grid-cols-3 border-t border-stone-300 bg-white lg:hidden" aria-label="编辑器面板">
      <button type="button" onClick={() => setMobilePanel('templates')} className={`text-xs font-black ${mobilePanel === 'templates' ? 'bg-teal-50 text-teal-800' : 'text-stone-600'}`}>模板与区段</button>
      <button type="button" onClick={() => setMobilePanel('canvas')} className={`text-xs font-black ${mobilePanel === 'canvas' ? 'bg-teal-50 text-teal-800' : 'text-stone-600'}`}>画布</button>
      <button type="button" onClick={() => setMobilePanel('format')} className={`text-xs font-black ${mobilePanel === 'format' ? 'bg-teal-50 text-teal-800' : 'text-stone-600'}`}>格式与图层</button>
    </nav>

    {aiDesignerOpen ? <div className="fixed inset-0 z-[110] flex items-center justify-center bg-stone-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !aiGenerating) setAiDesignerOpen(false); }}>
      <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto border border-stone-300 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div className="flex items-center gap-2 text-lg font-black"><Sparkles size={20} className="text-teal-700"/>AI 设计品牌前页</div>
          <button type="button" onClick={() => setAiDesignerOpen(false)} disabled={aiGenerating} className="flex h-9 w-9 items-center justify-center border border-stone-300 disabled:opacity-40" aria-label="关闭 AI 设计"><X size={17}/></button>
        </header>
        <div className="space-y-5 p-5">
          <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold leading-6 text-emerald-800">✅ 系统已就绪（阿富 AI 品牌视觉与页面生成引擎 v2.5 · 推广期品牌方免费额度补贴）。模板、空白画布、AI 智能生成、手动调整、预览和发布均已接通可用，平台服务费 ¥0。</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-stone-200 bg-stone-50 p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-teal-700"><Coins size={15}/>AI 余额</div>
              <div className="mt-2 text-2xl font-black">{aiAvailableText}</div>
              <div className="mt-1 text-xs font-bold text-stone-500">目前可用余额</div>
              <div className="mt-3 border-t border-stone-200 pt-3 text-xs font-bold leading-5 text-stone-600">{aiCredit?.recharge.message || '正在读取 AI 余额状态...'}</div>
            </div>
            <div className="border border-stone-200 p-4">
              <div className="text-xs font-black uppercase text-teal-700">本次成本确认</div>
              <dl className="mt-3 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <dt className="font-bold text-stone-500">服务</dt><dd className="font-black">{aiService?.name || 'AI 生成整页'}</dd>
                <dt className="font-bold text-stone-500">官方单位</dt><dd className="font-black">{aiService?.billingUnit || '实际用量'}</dd>
                <dt className="font-bold text-stone-500">官方成本</dt><dd className="font-black">{aiPriceText}</dd>
                <dt className="font-bold text-stone-500">图片服务</dt><dd className="font-black">{aiGenerateImage ? aiImageService?.officialUnitCost == null ? '待官方成本配置' : `${aiImageService.officialUnitCost} ${aiImageService.officialCurrency} / ${aiImageService.billingUnit}` : '本次不使用'}</dd>
                <dt className="font-bold text-stone-500">汇率时间</dt><dd className="font-black">{aiExchangeText} · {aiService?.exchangeRateUpdatedAt || '待确认'}</dd>
                <dt className="font-bold text-stone-500">平台服务费</dt><dd className="font-black">¥0</dd>
                <dt className="font-bold text-stone-500">预估扣款</dt><dd className="font-black">{aiEstimateText}</dd>
                <dt className="font-bold text-stone-500">扣款规则</dt><dd className="font-bold text-stone-700">确认后先预扣；按实际 token 与成功图片张数结算。失败、逾时或无结果不扣款，预扣差额自动退回。</dd>
              </dl>
              {aiCreditLoading ? <div className="mt-3 text-xs font-bold text-stone-500">正在读取官方成本...</div> : null}
              {aiQuote?.unavailableReason || aiImageUnavailableReason || aiBalanceUnavailableReason ? <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">{aiQuote?.unavailableReason || aiImageUnavailableReason || aiBalanceUnavailableReason}</div> : null}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-black text-stone-700">视觉方向</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{([{ id: 'auto', name: '自动' }, { id: 'natural', name: '自然' }, { id: 'technology', name: '科技' }, { id: 'editorial', name: '质感' }, { id: 'commerce', name: '销售' }] as const).map((item) => <button key={item.id} type="button" onClick={() => setAiDirection(item.id)} className={`h-10 border text-xs font-black ${aiDirection === item.id ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-stone-300 bg-white text-stone-700'}`}>{item.name}</button>)}</div>
          </div>
          <label className="block text-xs font-black text-stone-700">品牌感觉<textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} maxLength={500} rows={5} placeholder="例如：清爽、专业、有自然光，强调科技感但不要冰冷" className="mt-2 w-full resize-y border border-stone-300 px-3 py-3 text-sm font-medium outline-none focus:border-teal-700"/></label>
          <label className="flex items-center gap-3 border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold"><input type="checkbox" checked={aiGenerateImage} onChange={(event) => setAiGenerateImage(event.target.checked)} className="h-4 w-4 accent-teal-700"/>生成专属主视觉</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-stone-200 p-3">
              <div className="text-xs font-black text-stone-500">储值记录</div>
              <div className="mt-2 text-xs font-bold text-stone-500">{aiCredit?.topUps.length ? `${aiCredit.topUps.length} 笔` : '暂无记录；模型与结算币别确认前不启用储值付款'}</div>
            </div>
            <div className="border border-stone-200 p-3">
              <div className="text-xs font-black text-stone-500">AI 使用明细</div>
              <div className="mt-2 text-xs font-bold text-stone-500">{aiCredit?.usages.length ? `${aiCredit.usages.length} 笔，最近：${aiCredit.usages[0].serviceName} · ${aiCredit.usages[0].status}` : '暂无 AI 扣款记录'}</div>
            </div>
          </div>
          {aiError ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{aiError}</div> : null}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-5 py-4">
          <button type="button" onClick={() => setAiDesignerOpen(false)} disabled={aiGenerating} className="h-10 border border-stone-300 px-4 text-sm font-black disabled:opacity-40">取消</button>
          <button type="button" onClick={loadAiCredit} disabled={aiGenerating || aiCreditLoading} className="h-10 border border-stone-300 px-4 text-sm font-black disabled:opacity-40">刷新官方成本</button>
          <button type="button" onClick={generateAiDesign} disabled={!aiCanConfirm} className="flex h-10 items-center gap-2 bg-teal-700 px-5 text-sm font-black text-white disabled:bg-stone-400"><Sparkles size={16}/>{aiGenerating ? '生成中...' : '确认成本并生成'}</button>
        </footer>
      </section>
    </div> : null}
    {confirmTemplateId ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmTemplateId(null); }}>
      <section className="w-full max-w-md border border-stone-300 bg-white shadow-2xl">
        <header className="border-b border-stone-200 px-5 py-4"><div className="text-lg font-black">套用模板</div></header>
        <div className="space-y-3 p-5 text-sm font-bold leading-6 text-stone-700">
          <p>套用「{BRAND_PAGE_TEMPLATES.find((item) => item.id === confirmTemplateId)?.name || '模板'}」会覆盖目前草稿的区段、自由图层、颜色、文字和图片起点。</p>
          <p>已发布版本不会被覆盖；你仍可用复原回到套用前状态。</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-stone-200 px-5 py-4">
          <button type="button" onClick={() => setConfirmTemplateId(null)} className="h-10 border border-stone-300 px-4 text-sm font-black">取消</button>
          <button type="button" disabled={applyingTemplate} onClick={() => { const template = confirmTemplateId; setConfirmTemplateId(null); void applyTemplate(template); }} className="h-10 bg-teal-700 px-5 text-sm font-black text-white disabled:bg-stone-400">{applyingTemplate ? '套用并保存中...' : '确认套用完整模板'}</button>
        </footer>
      </section>
    </div> : null}
    {preview ? <div className="fixed inset-0 z-[100] flex flex-col bg-[#dfe1de]"><header className="flex h-16 items-center justify-between border-b border-stone-300 bg-white px-4"><div className="font-black">草稿预览</div><button type="button" onClick={() => setPreview(false)} className="flex h-10 w-10 items-center justify-center border border-stone-300" aria-label="关闭预览"><X size={18}/></button></header><div className="min-h-0 flex-1 overflow-auto p-6"><div className={`mx-auto bg-white ${document.designDevice === 'mobile' ? 'w-[390px] max-w-full' : 'w-full max-w-[1040px]'}`}><BrandPageRenderer document={document} products={products}/></div></div></div> : null}
  </main>;
}
