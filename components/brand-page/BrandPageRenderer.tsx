'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Lock, Package, RotateCw, ShoppingCart, Trash2, Unlock } from 'lucide-react';
import { useCart } from '@/app/providers';
import { pageContentHeight, type BrandPageBlock, type BrandPageDocument, type BrandPageLayer } from '@/lib/brand-page-builder';

export type BrandPageProduct = {
  id: number;
  name: string;
  category?: string;
  description?: string;
  imageUrl?: string;
  priceCny?: string | number;
  listingType?: string | null;
  compareAtPrice?: string | number | null;
  stockQuantity?: number;
  createdAt?: string;
};

type EditorBindings = {
  selectedId: string | null;
  editingTextId: string | null;
  onSelect: (kind: 'block' | 'layer', id: string) => void;
  onBlockTextSelect: (id: string, field: 'title' | 'body') => void;
  onBlockTextEditStart: (id: string, field: 'title' | 'body') => void;
  onBlockTextChange: (id: string, field: 'title' | 'body', text: string) => void;
  onBlockTextPointerDown?: (event: ReactPointerEvent<HTMLElement>, block: BrandPageBlock, field: 'title' | 'body') => void;
  onTextEditStart: (id: string) => void;
  onTextEditEnd: (id: string) => void;
  onLayerPointerDown: (event: ReactPointerEvent<HTMLElement>, layer: BrandPageLayer, mode: 'move' | 'resize' | 'rotate', handle?: ResizeHandle) => void;
  onLayerTextChange: (id: string, text: string) => void;
  onLayerAction: (action: 'duplicate' | 'delete' | 'lock' | 'hide', layer: BrandPageLayer) => void;
};

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function money(value: string | number | undefined) {
  const amount = Number(value || 0);
  return `¥${amount.toFixed(2)}`;
}

function BlockBackground({ block }: { block: BrandPageBlock }) {
  if (!block.imageUrl) return null;
  return <img
    src={block.imageUrl}
    alt=""
    draggable={false}
    className="absolute inset-0 h-full w-full select-none"
    style={{
      objectFit: block.imageFit,
      objectPosition: `${block.focalX}% ${block.focalY}%`,
      opacity: block.imageOpacity / 100,
      transform: `scale(${block.imageScale / 100})`,
      transformOrigin: `${block.focalX}% ${block.focalY}%`,
    }}
  />;
}

function BlockImage({ block }: { block: BrandPageBlock }) {
  if (!block.imageUrl) {
    return <div className="flex h-full w-full items-center justify-center border border-black/10 bg-black/5"><Package size={48} className="opacity-20" /></div>;
  }
  return <div className="h-full w-full overflow-hidden">
    <img
      src={block.imageUrl}
      alt=""
      draggable={false}
      className="h-full w-full select-none"
      style={{
        objectFit: block.imageFit,
        objectPosition: `${block.focalX}% ${block.focalY}%`,
        opacity: block.imageOpacity / 100,
        transform: `scale(${block.imageScale / 100})`,
        transformOrigin: `${block.focalX}% ${block.focalY}%`,
      }}
    />
  </div>;
}

function ProductCards({ block, products, editable }: { block: BrandPageBlock; products: BrandPageProduct[]; editable: boolean }) {
  const router = useRouter();
  const { addItem } = useCart();
  const selected = block.productMode === 'selected' ? products.filter((item) => block.productIds.includes(item.id)) : products;
  const sorted = [...selected].sort((a, b) => block.productSort === 'price_asc' ? Number(a.priceCny || 0) - Number(b.priceCny || 0) : block.productSort === 'price_desc' ? Number(b.priceCny || 0) - Number(a.priceCny || 0) : String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const add = (product: BrandPageProduct) => {
    if (editable) return;
    if (product.listingType === 'shared_device') { router.push(`/cn/shop/${product.id}`); return; }
    addItem({ productId: product.id, name: product.name, price: Number(product.priceCny || 0), quantity: 1, imageUrl: product.imageUrl, currency: 'CNY', marketRegion: 'CN' });
    if (block.productAction === 'buy') router.push('/cn/cart');
  };
  if (!sorted.length) return <div className="flex h-52 items-center justify-center border border-dashed border-stone-300 bg-white/70 text-lg font-bold text-stone-400">上架商品后将在这里显示</div>;
  return <div className="grid gap-[16px]" style={{ gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))` }}>
    {sorted.slice(0, 12).map((product) => <article key={product.id} className="min-w-0 overflow-hidden border border-black/10 bg-white shadow-[0_8px_24px_rgba(28,25,23,.08)]">
      <Link href={editable ? '#' : `/cn/shop/${product.id}`} onClick={(event) => { if (editable) event.preventDefault(); }} tabIndex={editable ? -1 : 0}>
        <div className="flex aspect-square items-center justify-center overflow-hidden bg-stone-100">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} draggable={false} className="h-full w-full object-cover" /> : <Package size={40} className="text-stone-300" />}</div>
      </Link>
      <div className="p-[16px]">
        <div className="truncate text-[12px] font-bold uppercase" style={{ color: 'var(--brand-accent)' }}>{product.category || '品牌商品'}</div>
        <div className="mt-8 min-h-[48px] overflow-hidden text-[17px] font-extrabold leading-6 text-stone-900">{product.name}</div>
        <div className="mt-[12px] flex items-end justify-between gap-[8px]">
          <div>{product.listingType === 'shared_device' ? <div className="text-[15px] font-black text-stone-900">投放合作 · 洽谈</div> : block.showPrice ? <div><div className="text-[21px] font-black text-red-700">{money(product.priceCny)}</div>{block.showDiscount && Number(product.compareAtPrice || 0) > Number(product.priceCny || 0) ? <div className="text-[11px] font-semibold text-stone-400 line-through">{money(product.compareAtPrice || 0)}</div> : null}</div> : null}{block.showStock && product.listingType !== 'shared_device' ? <div className="mt-4 text-[11px] font-semibold text-stone-500">库存 {product.stockQuantity ?? 0}</div> : null}</div>
          {product.listingType === 'shared_device' ? <button type="button" onClick={() => add(product)} className="flex h-[36px] shrink-0 items-center justify-center bg-stone-950 px-3 text-[12px] font-black text-white">留资料洽谈</button> : <button type="button" onClick={() => add(product)} aria-label={block.productAction === 'buy' ? '立即购买' : '加入购物车'} className="flex h-[36px] w-[36px] shrink-0 items-center justify-center bg-stone-950 text-white"><ShoppingCart size={17} /></button>}
        </div>
      </div>
    </article>)}
  </div>;
}

function blockTextEditId(blockId: string, field: 'title' | 'body') {
  return `block:${blockId}:${field}`;
}

function EditableBlockText({
  block,
  field,
  as: Tag,
  className,
  children,
  editor,
}: {
  block: BrandPageBlock;
  field: 'title' | 'body';
  as: 'h2' | 'p';
  className: string;
  children: string;
  editor?: EditorBindings;
}) {
  const editing = Boolean(editor && editor.editingTextId === blockTextEditId(block.id, field));
  const handleSelect = (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
    if (!editor) return;
    event.stopPropagation();
    editor.onBlockTextSelect(block.id, field);
  };
  return <Tag
    data-block-text-field={field}
    contentEditable={editing}
    suppressContentEditableWarning
    onClick={handleSelect}
    onPointerDown={(event) => { handleSelect(event); if (!editing) editor?.onBlockTextPointerDown?.(event, block, field); }}
    onDoubleClick={(event) => {
      if (!editor) return;
      event.stopPropagation();
      editor.onBlockTextEditStart(block.id, field);
      const target = event.currentTarget;
      window.requestAnimationFrame(() => target.focus());
    }}
    onBlur={(event) => {
      if (!editor || !editing) return;
      editor.onBlockTextChange(block.id, field, event.currentTarget.textContent || '');
      editor.onTextEditEnd(blockTextEditId(block.id, field));
    }}
    className={`${className} ${editor ? 'cursor-text rounded-[2px] outline-offset-4 hover:outline hover:outline-2 hover:outline-teal-500/45' : ''} ${editing ? 'outline outline-2 outline-teal-600' : ''}`}
    style={{ touchAction: editor ? 'none' : undefined, pointerEvents: editor ? 'auto' : undefined, height: !children ? block.textPlaceholders?.[field] : undefined }}
  >{children}</Tag>;
}

function BlockAccentFallback({ visible, width = 64, height = 5, margin = 24 }: { visible: boolean; width?: number; height?: number; margin?: number }) {
  return visible ? <div style={{ width, height, marginBottom: margin, backgroundColor: 'var(--brand-accent)' }} /> : null;
}

function BlockContent({ block, products, editable, editor, hasDecorLayer }: { block: BrandPageBlock; products: BrandPageProduct[]; editable: boolean; editor?: EditorBindings; hasDecorLayer: boolean }) {
  if (block.type === 'spacer') return null;
  if (block.type === 'products') return <div style={{ padding: block.padding }}><div className="mb-[24px] flex items-end justify-between"><div>{(block.title || block.textPlaceholders?.title) ? <EditableBlockText block={block} field="title" as="h2" editor={editor} className="text-[34px] font-black leading-tight">{block.title}</EditableBlockText> : null}{(block.body || block.textPlaceholders?.body) ? <EditableBlockText block={block} field="body" as="p" editor={editor} className="mt-[10px] max-w-[680px] whitespace-pre-line text-[16px] font-medium leading-7 opacity-70">{block.body}</EditableBlockText> : null}</div><div className="text-[13px] font-bold opacity-50">{products.length} 款商品</div></div><ProductCards block={block} products={products} editable={editable} /></div>;
  if (block.type === 'text') return <div className="relative z-10 flex h-full items-center" style={{ padding: block.padding, pointerEvents: editor ? 'none' : undefined }}>
    <div className="max-w-[790px]">
      <BlockAccentFallback visible={!hasDecorLayer} />
      {(block.title || block.textPlaceholders?.title) ? <EditableBlockText block={block} field="title" as="h2" editor={editor} className="text-[46px] font-black leading-[1.16]">{block.title}</EditableBlockText> : null}
      {(block.body || block.textPlaceholders?.body) ? <EditableBlockText block={block} field="body" as="p" editor={editor} className="mt-[28px] max-w-[720px] whitespace-pre-line text-[20px] font-medium leading-[1.9] opacity-80">{block.body}</EditableBlockText> : null}
    </div>
  </div>;
  if (block.type === 'image_text') {
    const imageFirst = block.layout === 'image_left';
    const imageWidth = Math.min(68, Math.max(32, block.imageWidth));
    return <div className="relative z-10 grid h-full" style={{ gridTemplateColumns: imageFirst ? `${imageWidth}% 1fr` : `1fr ${imageWidth}%`, pointerEvents: editor ? 'none' : undefined }}>
      <div className={imageFirst ? 'order-1' : 'order-2'}><BlockImage block={block} /></div>
      <div className={`flex min-w-0 items-center ${imageFirst ? 'order-2' : 'order-1'}`} style={{ padding: block.padding }}>
        <div className="max-w-[470px]">
          <BlockAccentFallback visible={!hasDecorLayer} width={54} height={4} margin={20} />
          {(block.title || block.textPlaceholders?.title) ? <EditableBlockText block={block} field="title" as="h2" editor={editor} className="text-[40px] font-black leading-[1.2]">{block.title}</EditableBlockText> : null}
          {(block.body || block.textPlaceholders?.body) ? <EditableBlockText block={block} field="body" as="p" editor={editor} className="mt-[24px] whitespace-pre-line text-[18px] font-medium leading-[1.85] opacity-75">{block.body}</EditableBlockText> : null}
        </div>
      </div>
    </div>;
  }
  return null;
}

function LayerControls({ layer, editor }: { layer: BrandPageLayer; editor: EditorBindings }) {
  const handles: Array<{ id: ResizeHandle; className: string; cursor: string }> = [
    { id: 'nw', className: '-left-[7px] -top-[7px]', cursor: 'cursor-nw-resize' },
    { id: 'n', className: 'left-1/2 -top-[7px] -translate-x-1/2', cursor: 'cursor-n-resize' },
    { id: 'ne', className: '-right-[7px] -top-[7px]', cursor: 'cursor-ne-resize' },
    { id: 'e', className: '-right-[7px] top-1/2 -translate-y-1/2', cursor: 'cursor-e-resize' },
    { id: 'se', className: '-bottom-[7px] -right-[7px]', cursor: 'cursor-se-resize' },
    { id: 's', className: '-bottom-[7px] left-1/2 -translate-x-1/2', cursor: 'cursor-s-resize' },
    { id: 'sw', className: '-bottom-[7px] -left-[7px]', cursor: 'cursor-sw-resize' },
    { id: 'w', className: '-left-[7px] top-1/2 -translate-y-1/2', cursor: 'cursor-w-resize' },
  ];
  return <>
    <div className="pointer-events-none absolute inset-0 border-2 border-teal-500" />
    <button type="button" aria-label="旋转图层" title="旋转" onPointerDown={(event) => editor.onLayerPointerDown(event, layer, 'rotate')} className="absolute left-1/2 top-[-34px] flex h-[22px] w-[22px] -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-teal-700 bg-white text-teal-800 shadow"><RotateCw size={13}/></button>
    {handles.map((handle) => <button key={handle.id} type="button" aria-label="缩放图层" onPointerDown={(event) => editor.onLayerPointerDown(event, layer, 'resize', handle.id)} className={`absolute h-[14px] w-[14px] border-2 border-white bg-teal-600 shadow ${handle.className} ${handle.cursor}`} />)}
    <div className="absolute left-0 top-[-44px] flex h-8 items-center gap-1 rounded bg-stone-950 px-1 text-white shadow">
      <button type="button" title={layer.locked ? '解锁' : '锁定'} onClick={(event) => { event.stopPropagation(); editor.onLayerAction('lock', layer); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/15">{layer.locked ? <Lock size={13}/> : <Unlock size={13}/>}</button>
      <button type="button" title={layer.hidden ? '显示' : '隐藏'} onClick={(event) => { event.stopPropagation(); editor.onLayerAction('hide', layer); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/15">{layer.hidden ? <EyeOff size={13}/> : <Eye size={13}/>}</button>
      <button type="button" title="复制" onClick={(event) => { event.stopPropagation(); editor.onLayerAction('duplicate', layer); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/15"><Copy size={13}/></button>
      <button type="button" title="删除" onClick={(event) => { event.stopPropagation(); editor.onLayerAction('delete', layer); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/15"><Trash2 size={13}/></button>
    </div>
  </>;
}

export function BrandPageRenderer({ document, products, fit = true, editor }: { document: BrandPageDocument; products: BrandPageProduct[]; fit?: boolean; editor?: EditorBindings }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number>(document.designWidth);
  useEffect(() => {
    if (!containerRef.current || !fit) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fit]);
  const logicalWidth = document.designWidth;
  const height = pageContentHeight(document);
  const scale = fit ? Math.min(1, availableWidth / logicalWidth) : 1;
  const blockTops = useMemo(() => {
    let top = 0;
    return Object.fromEntries(document.blocks.map((block) => { const current = top; top += block.height; return [block.id, current]; }));
  }, [document.blocks]);

  return <div ref={containerRef} className="w-full overflow-hidden" style={{ height: height * scale }}>
    <div
      data-brand-canvas
      className="relative origin-top-left overflow-hidden shadow-[0_12px_36px_rgba(28,25,23,.14)]"
      style={{ width: logicalWidth, height, transform: `scale(${scale})`, backgroundColor: document.theme.backgroundColor, fontFamily: document.theme.fontFamily, ['--brand-accent' as string]: document.theme.accentColor }}
    >
      {document.blocks.map((block) => <section key={block.id} data-block-id={block.id} onClick={(event) => { if (editor) { event.stopPropagation(); editor.onSelect('block', block.id); } }} className={`relative overflow-hidden ${editor?.selectedId === block.id ? 'outline outline-4 outline-offset-[-4px] outline-teal-500' : ''}`} style={{ height: block.height, backgroundColor: block.backgroundColor, color: block.color }}>
        {block.type !== 'image_text' ? <BlockBackground block={block} /> : null}
        <BlockContent block={block} products={products} editable={Boolean(editor)} editor={editor} hasDecorLayer={document.editableDecorations === true || document.pageLayers.some((layer) => layer.sectionId === block.id && layer.type === 'shape' && layer.height <= 14)} />
      </section>)}
      {document.pageLayers.filter((layer) => editor || !layer.hidden).map((layer) => <div
        key={layer.id}
        data-layer-id={layer.id}
        onClick={(event) => { if (editor) { event.stopPropagation(); editor.onSelect('layer', layer.id); } }}
        onPointerDown={(event) => {
          if (editor?.editingTextId === layer.id) return;
          editor?.onLayerPointerDown(event, layer, 'move');
        }}
        className={`absolute select-none ${editor && !layer.locked ? 'cursor-move' : 'pointer-events-none'} ${layer.hidden ? 'opacity-30' : ''}`}
        style={{ touchAction: editor ? 'none' : undefined, left: `${layer.xPct}%`, top: layer.y, width: `${layer.widthPct}%`, height: layer.height, opacity: layer.opacity / 100, transform: `rotate(${layer.rotation}deg)`, zIndex: layer.zIndex, color: layer.color, backgroundColor: layer.type === 'shape' ? layer.backgroundColor : 'transparent' }}
      >
        {editor && !layer.locked && layer.type === 'shape' && layer.height * scale < 14 ? <div aria-hidden="true" data-layer-hit-area className="absolute inset-x-0 top-1/2 -translate-y-1/2" style={{ height: 14 / Math.max(scale, 0.01), minWidth: 14 / Math.max(scale, 0.01) }} /> : null}
        {layer.type === 'text' ? <div
          contentEditable={Boolean(editor && editor.editingTextId === layer.id && !layer.locked)}
          suppressContentEditableWarning
          onBlur={(event) => {
            editor?.onLayerTextChange(layer.id, event.currentTarget.textContent || '');
            editor?.onTextEditEnd(layer.id);
          }}
          onPointerDown={(event) => { if (editor?.editingTextId === layer.id && !layer.locked) event.stopPropagation(); }}
          onDoubleClick={(event) => {
            if (!editor || layer.locked) return;
            event.stopPropagation();
            editor.onSelect('layer', layer.id);
            editor.onTextEditStart(layer.id);
            const target = event.currentTarget;
            window.requestAnimationFrame(() => target.focus());
          }}
          className="h-full w-full overflow-hidden whitespace-pre-wrap leading-tight outline-none"
          style={{ fontSize: layer.fontSize, fontWeight: layer.fontWeight, lineHeight: layer.lineHeight }}
        >{layer.text}</div> : null}
        {layer.type === 'image' ? layer.imageUrl ? <img src={layer.imageUrl} alt="" draggable={false} className="h-full w-full object-contain" /> : null : null}
        {editor?.selectedId === layer.id ? <LayerControls layer={layer} editor={editor} /> : null}
      </div>)}
    </div>
  </div>;
}
