export type BrandPageTemplateId = 'brand_story' | 'product_focus' | 'editorial' | 'blank' | 'ai_generated';
export type BrandPageDevice = 'desktop' | 'mobile';
export type BrandPageBlockType = 'image' | 'text' | 'image_text' | 'products' | 'spacer';
export type BrandPageLayerType = 'text' | 'image' | 'shape';

export type BrandPageBlock = {
  id: string;
  type: BrandPageBlockType;
  title: string;
  body: string;
  textPlaceholders?: { title?: number; body?: number };
  height: number;
  backgroundColor: string;
  color: string;
  padding: number;
  imageUrl: string;
  imageFit: 'cover' | 'contain';
  imageWidth: number;
  imageHeight: number;
  imageScale: number;
  focalX: number;
  focalY: number;
  imageOpacity: number;
  imageAlign: 'left' | 'center' | 'right';
  layout: 'image_left' | 'image_right';
  productMode: 'all' | 'selected';
  productIds: number[];
  productSort: 'newest' | 'price_asc' | 'price_desc';
  columns: number;
  showPrice: boolean;
  showDiscount: boolean;
  showStock: boolean;
  productAction: 'cart' | 'buy';
};

export type BrandPageLayer = {
  id: string;
  type: BrandPageLayerType;
  sectionId: string | null;
  locked: boolean;
  hidden: boolean;
  xPct: number;
  y: number;
  widthPct: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  text: string;
  imageUrl: string;
  color: string;
  backgroundColor: string;
  fontSize: number;
  lineHeight?: number;
  fontWeight: number;
};

export type BrandPageDocument = {
  editableDecorations?: boolean;
  status: 'draft' | 'published';
  selectedTemplateId: BrandPageTemplateId;
  designDevice: BrandPageDevice;
  designWidth: 1040 | 390;
  blocks: BrandPageBlock[];
  pageLayers: BrandPageLayer[];
  theme: {
    accentColor: string;
    backgroundColor: string;
    fontFamily: string;
  };
  draftVersion: number;
  publishedVersion: number;
  publishedAt: string | null;
  updatedAt: string;
};

export type BrandPageRecord = {
  status: 'draft' | 'published' | 'paused' | 'revision_requested';
  draft: BrandPageDocument;
  published: BrandPageDocument | null;
  moderationNote: string;
  moderatedAt: string | null;
  moderatedBy: number | null;
};

const BLOCK_TYPES: BrandPageBlockType[] = ['image', 'text', 'image_text', 'products', 'spacer'];
const LAYER_TYPES: BrandPageLayerType[] = ['text', 'image', 'shape'];
const TEMPLATE_IDS: BrandPageTemplateId[] = ['brand_story', 'product_focus', 'editorial', 'blank', 'ai_generated'];

export const BRAND_PAGE_TEMPLATES: Array<{ id: BrandPageTemplateId; name: string; previewImage: string; accent: string; background: string }> = [
  { id: 'brand_story', name: '品牌故事', previewImage: '/images/brand-templates/brand-story-hero.jpg', accent: '#c65c43', background: '#e8eee8' },
  { id: 'product_focus', name: '商品主打', previewImage: '/images/brand-templates/product-focus-hero.jpg', accent: '#b63b32', background: '#f5f6f2' },
  { id: 'editorial', name: '质感志风', previewImage: '/images/brand-templates/editorial-hero.jpg', accent: '#768452', background: '#e8e4dc' },
  { id: 'blank', name: '空白创作', previewImage: '', accent: '#17695c', background: '#ffffff' },
];

export type AiBrandPageDirection = 'natural' | 'technology' | 'editorial' | 'commerce';

export type AiBrandPagePlan = {
  direction: AiBrandPageDirection;
  accentColor: string;
  backgroundColor: string;
  darkColor: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  storyTitle: string;
  storyBody: string;
  featureTitle: string;
  featureBody: string;
  productTitle: string;
  productBody: string;
  imagePrompt: string;
};

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function string(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.slice(0, 5000) : fallback;
}

function color(value: unknown, fallback: string) {
  const next = string(value).trim();
  return /^#[0-9a-f]{6}$/i.test(next) ? next : fallback;
}

function imageSource(value: unknown) {
  const next = typeof value === 'string' ? value.trim() : '';
  if (!next) return '';
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(next)) {
    return next.length <= 2_100_000 ? next : '';
  }
  if (next.startsWith('/') || /^https?:\/\//.test(next)) return next.slice(0, 5000);
  return '';
}

export function createBrandPageBlock(type: BrandPageBlockType, overrides: Partial<BrandPageBlock> = {}): BrandPageBlock {
  const defaults: Record<BrandPageBlockType, Partial<BrandPageBlock>> = {
    image: { title: '', height: 460, backgroundColor: '#ffffff', imageHeight: 460 },
    text: { title: '', body: '', height: 300, backgroundColor: '#ffffff' },
    image_text: { title: '', body: '', height: 420, backgroundColor: '#ffffff', imageHeight: 300 },
    products: { title: '品牌商品', body: '', height: 560, backgroundColor: '#ffffff' },
    spacer: { title: '', body: '', height: 96, backgroundColor: '#ffffff' },
  };
  return {
    id: id('block'), type, title: '', body: '', height: 320, backgroundColor: '#ffffff', color: '#1c1917', padding: 56,
    imageUrl: '', imageFit: 'cover', imageWidth: 48, imageHeight: 300, imageScale: 100, focalX: 50, focalY: 50,
    imageOpacity: 100, imageAlign: 'center', layout: 'image_left', productMode: 'all', productIds: [], productSort: 'newest',
    columns: 4, showPrice: true, showDiscount: true, showStock: true, productAction: 'cart',
    ...defaults[type], ...overrides,
  };
}

export function createBrandPageLayer(type: BrandPageLayerType, overrides: Partial<BrandPageLayer> = {}): BrandPageLayer {
  return {
    id: id('layer'), type, sectionId: null, locked: false, hidden: false, xPct: 8, y: 80, widthPct: type === 'text' ? 56 : 30, height: type === 'text' ? 120 : 180,
    rotation: 0, opacity: 100, zIndex: 10, text: type === 'text' ? '输入文字' : '', imageUrl: '', color: type === 'text' ? '#1c1917' : '#ffffff',
    backgroundColor: type === 'shape' ? '#dfb85d' : '#ffffff', fontSize: 42, fontWeight: 800, ...overrides,
  };
}

function blockTop(blocks: BrandPageBlock[], blockId: string) {
  let top = 0;
  for (const block of blocks) {
    if (block.id === blockId) return top;
    top += block.height;
  }
  return 0;
}

function createBlockAccentLayer(blocks: BrandPageBlock[], block: BrandPageBlock, overrides: Partial<BrandPageLayer> = {}) {
  const top = blockTop(blocks, block.id);
  const isImageText = block.type === 'image_text';
  const textStartsAfterImage = isImageText && block.layout === 'image_left';
  const xPct = textStartsAfterImage ? block.imageWidth + (block.padding / 1040 * 100) : block.padding / 1040 * 100;
  return createBrandPageLayer('shape', {
    sectionId: block.id,
    xPct,
    y: top + Math.max(24, Math.round(block.height * 0.27)),
    widthPct: isImageText ? 5.2 : 6.2,
    height: isImageText ? 4 : 5,
    backgroundColor: overrides.backgroundColor || '#17695c',
    zIndex: 8,
    ...overrides,
  });
}

export function createTemplateDocument(template: BrandPageTemplateId, brandName: string, introduction: string): BrandPageDocument {
  const now = new Date().toISOString();
  const intro = introduction.trim() || '把专业、诚意与对生活的理解，放进每一次产品与服务之中。';
  let theme = { accentColor: '#17695c', backgroundColor: '#f5f7f4', fontFamily: 'Noto Sans SC' };
  let blocks: BrandPageBlock[];
  let pageLayers: BrandPageLayer[];
  if (template === 'blank') {
    blocks = [
      createBrandPageBlock('image', { height: 390, backgroundColor: '#ffffff' }),
    ];
    pageLayers = [];
  } else if (template === 'product_focus') {
    theme = { accentColor: '#b63b32', backgroundColor: '#f5f6f2', fontFamily: 'Noto Sans SC' };
    blocks = [
      createBrandPageBlock('image', { height: 560, backgroundColor: '#f4f5f1', imageUrl: '/images/brand-templates/product-focus-hero.jpg', focalX: 66, focalY: 50 }),
      createBrandPageBlock('products', { title: '本季主打', body: '从热销到新品，一次看见品牌最值得入手的选择。', height: 700, backgroundColor: '#f5f6f2', columns: 4 }),
      createBrandPageBlock('text', { title: '简单、清楚、值得选择', body: '严选产品 · 清楚信息 · 安心服务\n把复杂的选择，整理成轻松的日常。', height: 320, backgroundColor: '#13251e', color: '#f7f3ea', padding: 82 }),
      createBrandPageBlock('image_text', { title: '不只卖商品，也在经营信任', body: intro, height: 480, backgroundColor: '#ffffff', color: '#1c2722', padding: 70, imageUrl: '/images/brand-templates/brand-story-hero.jpg', focalX: 74, focalY: 54, layout: 'image_right' }),
    ];
    pageLayers = [
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 7, y: 88, widthPct: 38, height: 34, text: 'NEW COLLECTION', color: '#9a312a', fontSize: 17, fontWeight: 800, zIndex: 12 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 7, y: 130, widthPct: 42, height: 170, text: brandName, color: '#17201c', fontSize: 72, fontWeight: 900, zIndex: 14 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 7, y: 310, widthPct: 34, height: 82, text: '精选品牌好物\n让每一次购买都有明确理由', color: '#4a554f', fontSize: 23, fontWeight: 500, zIndex: 14 }),
      createBrandPageLayer('shape', { sectionId: blocks[0].id, xPct: 7, y: 430, widthPct: 18, height: 54, backgroundColor: '#b63b32', zIndex: 12 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 9, y: 444, widthPct: 14, height: 28, text: '查看主打商品', color: '#ffffff', fontSize: 16, fontWeight: 800, zIndex: 14 }),
      createBlockAccentLayer(blocks, blocks[2], { backgroundColor: '#b63b32' }),
      createBlockAccentLayer(blocks, blocks[3], { backgroundColor: '#b63b32' }),
    ];
  } else if (template === 'editorial') {
    theme = { accentColor: '#768452', backgroundColor: '#e8e4dc', fontFamily: 'Source Han Serif SC' };
    blocks = [
      createBrandPageBlock('image', { height: 680, backgroundColor: '#dedad2', imageUrl: '/images/brand-templates/editorial-hero.jpg', focalX: 45, focalY: 48 }),
      createBrandPageBlock('image_text', { title: '本期主题', body: intro, height: 520, padding: 76, backgroundColor: '#f5f1e8', color: '#273029', imageUrl: '/images/brand-templates/brand-story-hero.jpg', focalX: 70, focalY: 50, layout: 'image_left' }),
      createBrandPageBlock('text', { title: '慢一点，更接近品牌的本质', body: '我们相信，真正有质感的选择，不需要喧哗。\n它经得起观看，也经得起时间。', height: 330, padding: 90, backgroundColor: '#26372e', color: '#f5f1e8' }),
      createBrandPageBlock('products', { title: '编辑精选', body: '像翻阅一本刊物，慢慢找到与你生活相合的产品。', height: 650, backgroundColor: '#e8e4dc', columns: 3 }),
    ];
    pageLayers = [
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 61, y: 86, widthPct: 28, height: 34, text: 'THE EDIT / 01', color: '#f2eadb', fontSize: 17, fontWeight: 700, zIndex: 12 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 58, y: 145, widthPct: 35, height: 205, text: brandName, color: '#fffaf0', fontSize: 66, fontWeight: 900, zIndex: 14 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 60, y: 380, widthPct: 30, height: 110, text: '关于生活、选择\n以及值得被留下的事物', color: '#f4ecdd', fontSize: 23, fontWeight: 500, zIndex: 14 }),
      createBrandPageLayer('shape', { sectionId: blocks[0].id, xPct: 60, y: 530, widthPct: 12, height: 8, backgroundColor: '#d1a95c', zIndex: 14 }),
      createBlockAccentLayer(blocks, blocks[1], { backgroundColor: '#768452' }),
      createBlockAccentLayer(blocks, blocks[2], { backgroundColor: '#d1a95c' }),
    ];
  } else {
    theme = { accentColor: '#c65c43', backgroundColor: '#e8eee8', fontFamily: 'Noto Sans SC' };
    blocks = [
      createBrandPageBlock('image', { height: 600, backgroundColor: '#e8eee8', imageUrl: '/images/brand-templates/brand-story-hero.jpg', focalX: 66, focalY: 50 }),
      createBrandPageBlock('text', { title: '一个品牌，从相信开始', body: intro, height: 380, padding: 92, backgroundColor: '#153c35', color: '#f8f1e5' }),
      createBrandPageBlock('image_text', { title: '把坚持做成日常', body: '从每一种材料、每一次体验到每一项服务，\n我们把看不见的认真，变成你可以感受到的细节。', height: 520, padding: 74, backgroundColor: '#f1eee5', color: '#1c352f', imageUrl: '/images/brand-templates/editorial-hero.jpg', focalX: 34, focalY: 50, layout: 'image_right' }),
      createBrandPageBlock('products', { title: '值得认识的品牌精选', body: '从品牌故事继续往下，找到适合带回生活的选择。', height: 650, backgroundColor: '#ffffff', columns: 3 }),
    ];
    pageLayers = [
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 7, y: 106, widthPct: 36, height: 34, text: 'OUR STORY · 品牌故事', color: '#31584f', fontSize: 17, fontWeight: 800, zIndex: 12 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 7, y: 158, widthPct: 43, height: 190, text: brandName, color: '#102f29', fontSize: 74, fontWeight: 900, zIndex: 14 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 7, y: 355, widthPct: 38, height: 80, text: '把专业与温度，\n放进每一次认真选择。', color: '#3f5f56', fontSize: 23, fontWeight: 500, zIndex: 14 }),
      createBrandPageLayer('shape', { sectionId: blocks[0].id, xPct: 7, y: 478, widthPct: 17, height: 54, backgroundColor: '#c65c43', zIndex: 12 }),
      createBrandPageLayer('text', { sectionId: blocks[0].id, xPct: 9, y: 492, widthPct: 13, height: 28, text: '认识品牌', color: '#ffffff', fontSize: 16, fontWeight: 800, zIndex: 14 }),
      createBlockAccentLayer(blocks, blocks[1], { backgroundColor: '#c65c43' }),
      createBlockAccentLayer(blocks, blocks[2], { backgroundColor: '#c65c43' }),
    ];
  }
  return {
    editableDecorations: true,
    status: 'draft', selectedTemplateId: template, designDevice: 'desktop', designWidth: 1040, blocks, pageLayers,
    theme, draftVersion: 1, publishedVersion: 0, publishedAt: null, updatedAt: now,
  };
}

export function createAiBrandPageDocument(input: {
  brandName: string;
  introduction: string;
  plan: AiBrandPagePlan;
  heroImageUrl: string;
  supportingImageUrl?: string;
}): BrandPageDocument {
  const now = new Date().toISOString();
  const { brandName, plan } = input;
  const accentColor = color(plan.accentColor, '#b77c46');
  const backgroundColor = color(plan.backgroundColor, '#f2f4ef');
  const darkColor = color(plan.darkColor, '#173a32');
  const heroImageUrl = imageSource(input.heroImageUrl);
  const supportingImageUrl = imageSource(input.supportingImageUrl) || heroImageUrl;
  const editorial = plan.direction === 'editorial';
  const commerce = plan.direction === 'commerce';
  const technology = plan.direction === 'technology';
  const blocks = [
    createBrandPageBlock('image', {
      height: editorial ? 690 : 620,
      backgroundColor,
      imageUrl: heroImageUrl,
      focalX: editorial ? 40 : 66,
      focalY: 50,
    }),
    ...(commerce ? [createBrandPageBlock('products', {
      title: plan.productTitle,
      body: plan.productBody,
      height: 690,
      padding: 64,
      backgroundColor,
      color: darkColor,
      columns: 4,
    })] : []),
    createBrandPageBlock('text', {
      title: plan.featureTitle,
      body: plan.featureBody,
      height: technology ? 350 : 330,
      padding: 86,
      backgroundColor: darkColor,
      color: '#f7f4ec',
    }),
    createBrandPageBlock('image_text', {
      title: plan.storyTitle,
      body: plan.storyBody || input.introduction,
      height: 520,
      padding: 72,
      backgroundColor: editorial ? '#f4efe5' : '#ffffff',
      color: darkColor,
      imageUrl: supportingImageUrl,
      focalX: editorial ? 38 : 66,
      focalY: 50,
      layout: editorial ? 'image_left' : 'image_right',
      imageWidth: editorial ? 50 : 46,
    }),
    ...(!commerce ? [createBrandPageBlock('products', {
      title: plan.productTitle,
      body: plan.productBody,
      height: 670,
      padding: 64,
      backgroundColor,
      color: darkColor,
      columns: editorial ? 3 : 4,
    })] : []),
  ];
  const heroTitleLeft = editorial ? 57 : 7;
  const heroTextColor = editorial ? '#fffaf0' : darkColor;
  const pageLayers = [
    createBrandPageLayer('text', {
      sectionId: blocks[0].id,
      xPct: heroTitleLeft,
      y: editorial ? 90 : 100,
      widthPct: editorial ? 34 : 41,
      height: 34,
      text: plan.heroEyebrow,
      color: editorial ? '#f4ecdd' : accentColor,
      fontSize: 17,
      fontWeight: 800,
      zIndex: 12,
    }),
    createBrandPageLayer('text', {
      sectionId: blocks[0].id,
      xPct: heroTitleLeft,
      y: editorial ? 148 : 158,
      widthPct: editorial ? 36 : 43,
      height: 230,
      text: plan.heroTitle || brandName,
      color: heroTextColor,
      fontSize: editorial ? 58 : 60,
      fontWeight: 900,
      zIndex: 14,
    }),
    createBrandPageLayer('text', {
      sectionId: blocks[0].id,
      xPct: editorial ? 59 : 7,
      y: editorial ? 400 : 390,
      widthPct: editorial ? 31 : 38,
      height: 110,
      text: plan.heroSubtitle,
      color: editorial ? '#f4ecdd' : darkColor,
      fontSize: 18,
      fontWeight: 500,
      zIndex: 14,
    }),
    createBrandPageLayer('shape', {
      sectionId: blocks[0].id,
      xPct: editorial ? 59 : 7,
      y: editorial ? 540 : 512,
      widthPct: editorial ? 12 : 17,
      height: editorial ? 8 : 54,
      backgroundColor: accentColor,
      zIndex: 12,
    }),
    createBlockAccentLayer(blocks, blocks[commerce ? 2 : 1], { backgroundColor: accentColor }),
    createBlockAccentLayer(blocks, blocks[commerce ? 3 : 2], { backgroundColor: accentColor }),
    ...(!editorial ? [createBrandPageLayer('text', {
      sectionId: blocks[0].id,
      xPct: 9,
      y: 527,
      widthPct: 13,
      height: 28,
      text: commerce ? '查看主打商品' : '探索品牌',
      color: '#ffffff',
      fontSize: 16,
      fontWeight: 800,
      zIndex: 14,
    })] : []),
  ];
  return {
    status: 'draft',
    selectedTemplateId: 'ai_generated',
    designDevice: 'desktop',
    designWidth: 1040,
    blocks,
    pageLayers,
    theme: {
      accentColor,
      backgroundColor,
      fontFamily: editorial ? 'Source Han Serif SC' : 'Noto Sans SC',
    },
    draftVersion: 1,
    publishedVersion: 0,
    publishedAt: null,
    updatedAt: now,
  };
}

export function createBrandPageRecord(brandName: string, introduction: string, publishImmediately = false): BrandPageRecord {
  const draft = createTemplateDocument('brand_story', brandName, introduction);
  const published = publishImmediately ? { ...draft, status: 'published' as const, publishedVersion: 1, publishedAt: draft.updatedAt } : null;
  return { status: publishImmediately ? 'published' : 'draft', draft, published, moderationNote: '', moderatedAt: null, moderatedBy: null };
}

export function normalizeBrandPageBlock(value: unknown): BrandPageBlock {
  const row = value && typeof value === 'object' ? value as Partial<BrandPageBlock> : {};
  const type = BLOCK_TYPES.includes(row.type as BrandPageBlockType) ? row.type as BrandPageBlockType : 'text';
  const current = createBrandPageBlock(type);
  return {
    ...current,
    id: string(row.id, current.id).slice(0, 90),
    title: string(row.title, current.title).slice(0, 160), body: string(row.body, current.body),
    textPlaceholders: { title: clamp(row.textPlaceholders?.title, 0, 1800, 0), body: clamp(row.textPlaceholders?.body, 0, 1800, 0) },
    height: clamp(row.height, type === 'spacer' ? 24 : 120, 1400, current.height),
    backgroundColor: color(row.backgroundColor, current.backgroundColor), color: color(row.color, current.color), padding: clamp(row.padding, 0, 160, current.padding),
    imageUrl: imageSource(row.imageUrl), imageFit: row.imageFit === 'contain' ? 'contain' : 'cover', imageWidth: clamp(row.imageWidth, 10, 100, current.imageWidth),
    imageHeight: clamp(row.imageHeight, 60, 1200, current.imageHeight), imageScale: clamp(row.imageScale, 10, 300, current.imageScale),
    focalX: clamp(row.focalX, 0, 100, current.focalX), focalY: clamp(row.focalY, 0, 100, current.focalY), imageOpacity: clamp(row.imageOpacity, 0, 100, current.imageOpacity),
    imageAlign: ['left', 'right'].includes(String(row.imageAlign)) ? row.imageAlign as 'left' | 'right' : 'center',
    layout: row.layout === 'image_right' ? 'image_right' : 'image_left', productMode: row.productMode === 'selected' ? 'selected' : 'all',
    productIds: Array.isArray(row.productIds) ? row.productIds.map(Number).filter(Number.isFinite).slice(0, 100) : [],
    productSort: ['price_asc', 'price_desc'].includes(String(row.productSort)) ? row.productSort as 'price_asc' | 'price_desc' : 'newest',
    columns: Math.round(clamp(row.columns, 2, 4, current.columns)), showPrice: row.showPrice !== false, showDiscount: row.showDiscount !== false,
    showStock: row.showStock !== false, productAction: row.productAction === 'buy' ? 'buy' : 'cart',
  };
}

export function normalizeBrandPageLayer(value: unknown): BrandPageLayer {
  const row = value && typeof value === 'object' ? value as Partial<BrandPageLayer> : {};
  const type = LAYER_TYPES.includes(row.type as BrandPageLayerType) ? row.type as BrandPageLayerType : 'text';
  const current = createBrandPageLayer(type);
  return {
    ...current,
    id: string(row.id, current.id).slice(0, 90), sectionId: row.sectionId ? string(row.sectionId).slice(0, 90) : null,
    locked: row.locked === true, hidden: row.hidden === true,
    xPct: clamp(row.xPct, 0, 95, current.xPct), y: clamp(row.y, 0, 12000, current.y), widthPct: clamp(row.widthPct, 3, 100, current.widthPct),
    height: clamp(row.height, type === 'shape' ? 1 : 20, 1800, current.height), rotation: clamp(row.rotation, -180, 180, current.rotation), opacity: clamp(row.opacity, 0, 100, current.opacity),
    zIndex: Math.round(clamp(row.zIndex, 1, 999, current.zIndex)), text: string(row.text, current.text), imageUrl: imageSource(row.imageUrl),
    color: color(row.color, current.color), backgroundColor: color(row.backgroundColor, current.backgroundColor),
    fontSize: clamp(row.fontSize, 10, 180, current.fontSize), fontWeight: Math.round(clamp(row.fontWeight, 300, 900, current.fontWeight) / 100) * 100,
    lineHeight: clamp(row.lineHeight, 1, 3, 1.25),
  };
}

export function normalizeBrandPageDocument(value: unknown, fallback: BrandPageDocument): BrandPageDocument {
  const row = value && typeof value === 'object' ? value as Partial<BrandPageDocument> : {};
  const selectedTemplateId = TEMPLATE_IDS.includes(row.selectedTemplateId as BrandPageTemplateId) ? row.selectedTemplateId as BrandPageTemplateId : fallback.selectedTemplateId;
  const designDevice = row.designDevice === 'mobile' ? 'mobile' : 'desktop';
  const blocks = Array.isArray(row.blocks) ? row.blocks.map(normalizeBrandPageBlock).slice(0, 80) : fallback.blocks;
  const pageLayers = Array.isArray(row.pageLayers) ? row.pageLayers.map(normalizeBrandPageLayer).slice(0, 200) : fallback.pageLayers;
  if (!blocks.length) throw new Error('品牌前页至少需要一个区块');
  return {
    // Keep one desktop-sized logical canvas and scale it into the phone preview.
    // Persisting a 390px logical canvas made existing desktop layers overlap.
    status: row.status === 'published' ? 'published' : 'draft', selectedTemplateId, designDevice, designWidth: 1040,
    blocks, pageLayers, editableDecorations: row.editableDecorations === true || pageLayers.some((layer) => layer.sectionId && layer.type === 'shape'),
    theme: {
      accentColor: color(row.theme?.accentColor, fallback.theme.accentColor), backgroundColor: color(row.theme?.backgroundColor, fallback.theme.backgroundColor),
      fontFamily: string(row.theme?.fontFamily, fallback.theme.fontFamily).slice(0, 100) || fallback.theme.fontFamily,
    },
    draftVersion: Math.max(1, Math.round(clamp(row.draftVersion, 1, 1000000, fallback.draftVersion))),
    publishedVersion: Math.max(0, Math.round(clamp(row.publishedVersion, 0, 1000000, fallback.publishedVersion))),
    publishedAt: row.publishedAt ? string(row.publishedAt).slice(0, 40) : null,
    updatedAt: row.updatedAt ? string(row.updatedAt).slice(0, 40) : new Date().toISOString(),
  };
}

export function pageContentHeight(document: BrandPageDocument) {
  const blockHeight = document.blocks.reduce((sum, block) => sum + block.height, 0);
  const layerHeight = document.pageLayers.reduce((max, layer) => Math.max(max, layer.y + layer.height + 24), 0);
  return Math.max(blockHeight, layerHeight, 320);
}

export function rebaseSectionLayers(previous: BrandPageDocument, next: BrandPageDocument): BrandPageDocument {
  const tops = (blocks: BrandPageBlock[]) => {
    let top = 0;
    return new Map(blocks.map((block) => { const value: [string, number] = [block.id, top]; top += block.height; return value; }));
  };
  const before = tops(previous.blocks);
  const after = tops(next.blocks);
  // Layer y is persisted in page coordinates; preserve its section-local offset.
  return { ...next, editableDecorations: next.editableDecorations === true || previous.pageLayers.some((layer) => layer.sectionId && layer.type === 'shape'), pageLayers: next.pageLayers
    .filter((layer) => !layer.sectionId || after.has(layer.sectionId))
    .map((layer) => layer.sectionId && before.has(layer.sectionId)
      ? { ...layer, y: layer.y + after.get(layer.sectionId)! - before.get(layer.sectionId)! }
      : layer) };
}
