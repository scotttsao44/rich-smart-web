import {
  createBrandPageBlock, createBrandPageLayer, createTemplateDocument, normalizeBrandPageDocument,
  type BrandPageDocument, type BrandPageRecord, type BrandPageTemplateId,
} from './brand-page-builder';
import type { BrandPageActor } from './local-brand-page-repository';

export type BrandPageModuleType = 'story' | 'highlights' | 'products' | 'recommended' | 'certifications' | 'contact';

export type BrandPageModule = {
  id: string;
  type: BrandPageModuleType;
  title: string;
  body: string;
  enabled: boolean;
};

export type BrandPageConfig = {
  template: 'professional' | 'commerce' | 'story';
  theme: 'jade' | 'ink' | 'warm';
  tagline: string;
  heroImageUrl: string;
  modules: BrandPageModule[];
};

export type BrandPageStorageBrand = {
  id: number;
  brandName: string;
  companyName: string;
  introduction: string;
  pageTemplate?: string;
  pageConfig?: BrandPageConfig;
  brandPage?: BrandPageRecord;
  updatedAt: string;
};

export const moduleDefaults: Array<{ type: BrandPageModuleType; title: string; body: string }> = [
  { type: 'story', title: '品牌故事', body: '介绍品牌创立背景、坚持的理念与希望为消费者解决的问题。' },
  { type: 'highlights', title: '品牌亮点', body: '产品研发\n品质管理\n履约服务' },
  { type: 'products', title: '品牌自营商品', body: '' },
  { type: 'recommended', title: '品牌推荐', body: '展示经合作确认、由本品牌推荐的其他品牌商品。' },
  { type: 'certifications', title: '品牌资质', body: '营业执照、商标与商品资质经平台审核后展示。' },
  { type: 'contact', title: '联系品牌', body: '查看品牌的服务与售后联系方式。' },
];

function text(value: unknown) {
  return String(value ?? '').trim();
}

export function getBrandPageConfig(brand: BrandPageStorageBrand): BrandPageConfig {
  const saved = brand.pageConfig;
  const savedModules = Array.isArray(saved?.modules) ? saved.modules : [];
  const modules = moduleDefaults.map((fallback) => {
    const current = savedModules.find((item) => item?.type === fallback.type);
    const defaultBody = fallback.type === 'story' ? brand.introduction || fallback.body : fallback.body;
    return {
      id: text(current?.id) || fallback.type,
      type: fallback.type,
      title: text(current?.title) || fallback.title,
      body: current?.body == null ? defaultBody : text(current.body),
      enabled: current ? current.enabled !== false : true,
    };
  });
  const ordered = [
    ...savedModules.map((item) => modules.find((module) => module.type === item?.type)).filter(Boolean),
    ...modules.filter((module) => !savedModules.some((item) => item?.type === module.type)),
  ] as BrandPageModule[];
  const template = ['professional', 'commerce', 'story'].includes(String(saved?.template || brand.pageTemplate))
    ? String(saved?.template || brand.pageTemplate) as BrandPageConfig['template']
    : 'professional';
  const theme = ['jade', 'ink', 'warm'].includes(String(saved?.theme)) ? saved!.theme : 'jade';
  return {
    template,
    theme,
    tagline: text(saved?.tagline) || brand.introduction || `${brand.brandName}品牌商品与服务`,
    heroImageUrl: text(saved?.heroImageUrl),
    modules: ordered,
  };
}

function migrateLegacyBrandPage(brand: BrandPageStorageBrand): BrandPageRecord {
  const legacy = getBrandPageConfig(brand);
  const templateMap: Record<BrandPageConfig['template'], BrandPageTemplateId> = {
    professional: 'brand_story', commerce: 'product_focus', story: 'editorial',
  };
  const document = createTemplateDocument(templateMap[legacy.template], brand.brandName, '');
  const bodyFor = (type: BrandPageModuleType) => legacy.modules.find((module) => module.type === type && module.enabled)?.body || '';
  const titleFor = (type: BrandPageModuleType, fallback: string) => legacy.modules.find((module) => module.type === type && module.enabled)?.title || fallback;
  document.blocks = [
    createBrandPageBlock('image', { title: brand.brandName, imageUrl: legacy.heroImageUrl, height: legacy.template === 'commerce' ? 410 : 500, backgroundColor: legacy.theme === 'warm' ? '#744027' : legacy.theme === 'ink' ? '#222629' : '#173a34' }),
    createBrandPageBlock('text', { title: titleFor('story', '品牌故事'), body: bodyFor('story') || legacy.tagline || brand.introduction, height: 340 }),
    ...(legacy.modules.some((module) => module.type === 'highlights' && module.enabled) ? [createBrandPageBlock('image_text', { title: titleFor('highlights', '品牌亮点'), body: bodyFor('highlights'), height: 420 })] : []),
    ...(legacy.modules.some((module) => module.type === 'products' && module.enabled) ? [createBrandPageBlock('products', { title: titleFor('products', '品牌商品'), body: bodyFor('products'), height: 580 })] : []),
    ...(legacy.modules.some((module) => module.type === 'certifications' && module.enabled) ? [createBrandPageBlock('text', { title: titleFor('certifications', '品牌资质'), body: bodyFor('certifications'), height: 280, backgroundColor: '#eef2ef' })] : []),
    ...(legacy.modules.some((module) => module.type === 'contact' && module.enabled) ? [createBrandPageBlock('text', { title: titleFor('contact', '联系品牌'), body: bodyFor('contact') || brand.companyName, height: 260, backgroundColor: '#1c2522', color: '#ffffff' })] : []),
  ];
  document.pageLayers = [
    createBrandPageLayer('text', { text: brand.brandName, y: 145, widthPct: 76, fontSize: 70 }),
    createBrandPageLayer('text', { text: legacy.tagline || brand.introduction, y: 250, widthPct: 66, height: 110, fontSize: 22, fontWeight: 600, opacity: 88 }),
  ];
  const now = new Date().toISOString();
  document.status = 'published';
  document.publishedVersion = 1;
  document.publishedAt = now;
  document.updatedAt = now;
  return { status: 'published', draft: { ...document, status: 'draft' }, published: document, moderationNote: '', moderatedAt: null, moderatedBy: null };
}

export function getBrandPageRecord(brand: BrandPageStorageBrand): BrandPageRecord {
  if (!brand.brandPage) return migrateLegacyBrandPage(brand);
  const fallback = createTemplateDocument(brand.brandPage.draft?.selectedTemplateId || 'brand_story', brand.brandName, '');
  const draft = scrubTestBrandPageDocument(normalizeBrandPageDocument(brand.brandPage.draft, fallback));
  const published = brand.brandPage.published ? scrubTestBrandPageDocument(normalizeBrandPageDocument(brand.brandPage.published, draft)) : null;
  return {
    status: ['draft', 'published', 'paused', 'revision_requested'].includes(brand.brandPage.status) ? brand.brandPage.status : published ? 'published' : 'draft',
    draft: { ...draft, status: 'draft' },
    published: published ? { ...published, status: 'published' } : null,
    moderationNote: text(brand.brandPage.moderationNote),
    moderatedAt: brand.brandPage.moderatedAt || null,
    moderatedBy: brand.brandPage.moderatedBy || null,
  };
}

function scrubTestBrandPageDocument(document: BrandPageDocument): BrandPageDocument {
  const fixturePattern = /(TEST|测试|測試|虚构|虛構)/i;
  return {
    ...document,
    blocks: document.blocks.map((block) => ({
      ...block,
      title: fixturePattern.test(block.title) ? '' : block.title,
      body: fixturePattern.test(block.body) ? '' : block.body,
      imageUrl: fixturePattern.test(block.imageUrl) || block.imageUrl.includes('example.com/assets/test-') ? '' : block.imageUrl,
    })),
    pageLayers: document.pageLayers
      .map((layer) => ({ ...layer, text: fixturePattern.test(layer.text) ? '' : layer.text, imageUrl: fixturePattern.test(layer.imageUrl) || layer.imageUrl.includes('example.com/assets/test-') ? '' : layer.imageUrl }))
      .filter((layer) => layer.type !== 'text' || layer.text.trim()),
  };
}

export function createBrandPagePersistence<S, B extends BrandPageStorageBrand, U extends BrandPageActor>(
  repository: { withWrite<T>(operation: (state: S) => T): T },
  dependencies: {
    findEditableBrand: (state: S, user: U) => B;
    audit: (state: S, user: U, entityType: 'brand' | 'product', entityId: number, action: string, detail: string) => void;
  },
) {
  const { withWrite } = repository;
  const { findEditableBrand, audit } = dependencies;
  function saveBrandPageDraft(user: U, input: Record<string, unknown>) {
    return withWrite((state) => {
      const brand = findEditableBrand(state, user);
      const record = getBrandPageRecord(brand);
      const now = new Date().toISOString();
      const draft = normalizeBrandPageDocument(input.document || input, record.draft);
      draft.status = 'draft';
      draft.draftVersion = record.draft.draftVersion + 1;
      draft.publishedVersion = record.published?.publishedVersion || 0;
      draft.publishedAt = record.published?.publishedAt || null;
      draft.updatedAt = now;
      brand.brandPage = { ...record, draft, status: record.status === 'paused' ? 'paused' : record.status === 'revision_requested' ? 'revision_requested' : record.published ? 'published' : 'draft' };
      brand.pageTemplate = draft.selectedTemplateId;
      brand.updatedAt = now;
      audit(state, user, 'brand', brand.id, 'brand_page_draft_saved', `保存品牌前页草稿 v${draft.draftVersion}`);
      return brand;
    });
  }

  function publishBrandPage(user: U, input: Record<string, unknown>) {
    return withWrite((state) => {
      const brand = findEditableBrand(state, user);
      const record = getBrandPageRecord(brand);
      if (record.status === 'paused') throw new Error('品牌前页已被平台暂停，请先联系平台处理');
      const now = new Date().toISOString();
      const draft = normalizeBrandPageDocument(input.document || input || record.draft, record.draft);
      const publishedVersion = (record.published?.publishedVersion || 0) + 1;
      const published: BrandPageDocument = { ...draft, status: 'published', publishedVersion, publishedAt: now, updatedAt: now };
      brand.brandPage = {
        ...record,
        status: 'published',
        draft: { ...published, status: 'draft', draftVersion: Math.max(draft.draftVersion, record.draft.draftVersion) },
        published,
        moderationNote: '',
      };
      brand.pageTemplate = published.selectedTemplateId;
      brand.updatedAt = now;
      audit(state, user, 'brand', brand.id, 'brand_page_published', `发布品牌前页 v${publishedVersion}`);
      return brand;
    });
  }
  return { saveDraft: saveBrandPageDraft, publish: publishBrandPage };
}
