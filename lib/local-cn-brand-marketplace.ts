import {
  createBrandPagePersistence, getBrandPageRecord, getBrandPageConfig, moduleDefaults,
  type BrandPageModuleType, type BrandPageConfig,
} from './brand-page-persistence';
import {
  createLocalBrandMarketplaceRepository, appendBrandMarketplaceAudit,
  type BrandMarketplaceState,
} from './local-brand-page-repository';
import path from 'path';
import { hasPlatformAdminAccess, type SessionUser } from './auth';
import { isPlaceholderProduct } from './catalog';
import { getOrganizationRole, hasOrganizationMembership } from './local-cn-organization-members';
import {
  enforceBrandApplicationDocumentLimits,
  mergeLegacyBrandApplicationDocuments,
  type BrandApplicationDocument,
} from './brand-application-documents';
import { enforceStoredBrandApplicationDocumentOwnership } from './brand-document-ownership.server';
import { normalizeBrandCategorySelection } from './cn-brand-taxonomy';
import {
  createBrandPageRecord,
  type BrandPageRecord,
} from './brand-page-builder';

export { getBrandPageRecord, getBrandPageConfig } from './brand-page-persistence';
export type { BrandPageModuleType, BrandPageModule, BrandPageConfig } from './brand-page-persistence';
export type { BrandMarketplaceAudit } from './local-brand-page-repository';
type MarketplaceState = BrandMarketplaceState<LocalCnBrand, LocalCnBrandProduct>;

export type BrandReviewStatus = 'pending' | 'approved' | 'rejected';
export type BrandProductStatus = 'pending' | 'approved' | 'rejected';

export type BrandCommissionDefaults = {
  directRate: number;
  upperRate: number;
  activeRate: number;
  updatedAt?: string;
  updatedBy?: number;
};

export type LocalCnBrand = {
  id: number;
  slug: string;
  brandName: string;
  companyName: string;
  category?: string;
  categoryMajorId?: string;
  categoryMinorId?: string;
  categoryMajorLabel?: string;
  categoryMinorLabel?: string;
  categoryLabel?: string;
  officialWebsite?: string;
  socialLink?: string;
  contactName: string;
  phone: string;
  wechat: string;
  introduction: string;
  registrationNo?: string;
  legalRepresentative?: string;
  companyType?: string;
  registeredCapital?: string;
  establishmentDate?: string;
  companyAddress?: string;
  businessScope?: string;
  businessLicenseDocument?: string;
  businessLicenseName?: string;
  profileDocument?: string;
  profileDocumentName?: string;
  trademarkDocument?: string;
  trademarkName?: string;
  brandDocuments?: BrandApplicationDocument[];
  logoUrl?: string;
  pageTemplate?: string;
  pageConfig?: BrandPageConfig;
  brandPage?: BrandPageRecord;
  commissionDefaults?: BrandCommissionDefaults;
  brandReferralCode?: string;
  referrerBrandId?: number | null;
  referrerBrandName?: string;
  referrerBrandCode?: string;
  referrerRewardRate?: number;
  applicantUserId: number | null;
  accountUserId: number | null;
  status: BrandReviewStatus;
  reviewNote: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  createdAt: string;
  updatedAt: string;
};

// 已上架商品由非平台管理员修改时，修改内容先存为待审核修订；线上版本保持不变，管理员通过后才套用
export type BrandProductRevision = {
  fields: Record<string, unknown>;
  before: Record<string, unknown>;
  submittedAt: string;
  submittedBy: number;
  submittedByName?: string;
};

export type LocalCnBrandProduct = {
  id: number;
  slug: string;
  brandId: number;
  brandName: string;
  ownerUserId: number;
  sku: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  images?: string[];
  compareAtPrice?: number | null;
  variants?: Array<{ name: string; values: string[] }>;
  shippingMethods?: string[];
  salesStatus?: 'draft' | 'active' | 'sold_out' | 'archived';
  imageIsTest: boolean;
  imageDisclosure: string;
  priceCny: string;
  priceTwd: string;
  supplyPriceCny?: number;
  stockQuantity: number;
  fulfillmentInfo: string;
  commissionRate: string;
  directRate?: number;
  upperRate?: number;
  activeRate?: number;
  status: BrandProductStatus;
  reviewStatus: BrandProductStatus;
  reviewNote: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  sold?: number;
  rating?: string;
  pendingRevision?: BrandProductRevision | null;
  lastRevisionReview?: { decision: 'approved' | 'rejected'; note: string; reviewedAt: string; reviewedBy: number } | null;
  tag?: string;
};

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function slugify(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || `item-${Date.now()}`;
}

function readState(): MarketplaceState {
  const state = createLocalBrandMarketplaceRepository<LocalCnBrand, LocalCnBrandProduct>(path.resolve(dataDir())).readState();
  for (const b of state.brands || []) {
    if (b.companyName) b.companyName = text(b.companyName);
    if (b.brandName) b.brandName = text(b.brandName);
  }
  return state;
}

function withWrite<T>(operation: (state: MarketplaceState) => T): T {
  return createLocalBrandMarketplaceRepository<LocalCnBrand, LocalCnBrandProduct>(path.resolve(dataDir())).withWrite(operation);
}

function nextId(rows: Array<{ id: number }>) {
  const max = rows.reduce((value, row) => Math.max(value, row.id > 0 ? row.id : 0), 0);
  return Math.max(Date.now(), max + 1);
}

function audit(state: MarketplaceState, user: SessionUser, entityType: 'brand' | 'product', entityId: number, action: string, detail: string) {
  appendBrandMarketplaceAudit(state, user, entityType, entityId, action, detail);
}

function text(value: unknown) {
  return String(value ?? '')
    .replace(/^[“”"'「」『』\s]+|[“”"'「」『』\s]+$/g, '')
    .trim();
}

export function normalizeBrandCommissionDefaults(value: unknown): BrandCommissionDefaults {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const directRate = Number(source.directRate ?? 30);
  const upperRate = Number(source.upperRate ?? 5);
  const activeRate = Number(source.activeRate ?? 65);
  if ([directRate, upperRate, activeRate].some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)) {
    throw new Error('三段分润比例必须介于 0% 至 100%');
  }
  if (Math.abs(directRate + upperRate + activeRate - 100) > 0.001) {
    throw new Error('直接推荐、上层推荐与近30天销售贡献榜比例合计必须等于 100%');
  }
  return {
    directRate,
    upperRate,
    activeRate,
    ...(typeof source.updatedAt === 'string' ? { updatedAt: source.updatedAt } : {}),
    ...(Number.isFinite(Number(source.updatedBy)) ? { updatedBy: Number(source.updatedBy) } : {}),
  };
}

function findEditableBrand(state: MarketplaceState, user: SessionUser) {
  const brand = state.brands.find((row) => row.status === 'approved' && (row.accountUserId === user.id || row.applicantUserId === user.id || hasOrganizationMembership('brand', row.id, user.id)));
  if (!brand) throw new Error('品牌审核通过后才能编辑品牌前页');
  const isOwner = brand.accountUserId === user.id || brand.applicantUserId === user.id;
  if (!isOwner && !['admin', 'editor'].includes(getOrganizationRole('brand', brand.id, user.id) || '')) throw new Error('当前职位无权编辑品牌前页');
  return brand;
}

function normalizeBrandPageConfig(brand: LocalCnBrand, input: Record<string, unknown>): BrandPageConfig {
  const current = getBrandPageConfig(brand);
  const template = text(input.template) as BrandPageConfig['template'];
  const theme = text(input.theme) as BrandPageConfig['theme'];
  const tagline = text(input.tagline);
  const heroImageUrl = text(input.heroImageUrl);
  if (!['professional', 'commerce', 'story'].includes(template)) throw new Error('请选择有效的品牌前页版型');
  if (!['jade', 'ink', 'warm'].includes(theme)) throw new Error('请选择有效的品牌前页色系');
  if (!tagline) throw new Error('请填写品牌主介绍');
  if (tagline.length > 160) throw new Error('品牌主介绍不可超过 160 个字');
  if (heroImageUrl && !heroImageUrl.startsWith('/') && !/^https?:\/\//.test(heroImageUrl)) throw new Error('首图必须是有效网址或站内路径');
  const incoming = Array.isArray(input.modules) ? input.modules : [];
  if (incoming.length !== current.modules.length) throw new Error('品牌前页模组资料不完整');
  const seen = new Set<string>();
  const modules = incoming.map((value) => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const type = text(row.type) as BrandPageModuleType;
    if (!moduleDefaults.some((item) => item.type === type) || seen.has(type)) throw new Error('品牌前页模组重复或不存在');
    seen.add(type);
    const title = text(row.title);
    const body = text(row.body);
    if (!title || title.length > 40) throw new Error('模组标题须为 1 至 40 个字');
    if (body.length > 1200) throw new Error('模组内容不可超过 1200 个字');
    return { id: type, type, title, body, enabled: row.enabled !== false };
  });
  return { template, theme, tagline, heroImageUrl, modules };
}

function ensureBrandInput(input: Record<string, unknown>) {
  const brandName = text(input.brandName);
  const companyName = text(input.companyName);
  const categorySelection = normalizeBrandCategorySelection({
    categoryMajorId: input.categoryMajorId,
    categoryMinorId: input.categoryMinorId,
  });
  const category = categorySelection.categoryLabel;
  const officialWebsite = text(input.officialWebsite);
  const socialLink = text(input.socialLink);
  const contactName = text(input.contactName);
  const phone = text(input.phone);
  const wechat = text(input.wechat);
  const introduction = text(input.introduction);
  const registrationNo = text(input.registrationNo);
  const legalRepresentative = text(input.legalRepresentative);
  const companyType = text(input.companyType);
  const registeredCapital = text(input.registeredCapital);
  const establishmentDate = text(input.establishmentDate);
  const companyAddress = text(input.companyAddress);
  const businessScope = text(input.businessScope);
  const businessLicenseDocument = text(input.businessLicenseDocument);
  const businessLicenseName = text(input.businessLicenseName);
  const profileDocument = text(input.profileDocument);
  const profileDocumentName = text(input.profileDocumentName);
  const trademarkDocument = text(input.trademarkDocument);
  const trademarkName = text(input.trademarkName);
  const brandDocuments = enforceBrandApplicationDocumentLimits(mergeLegacyBrandApplicationDocuments(input.brandDocuments, [
    { token: businessLicenseDocument, name: businessLicenseName, kind: 'license' },
    { token: profileDocument, name: profileDocumentName, kind: 'brand_profile' },
    { token: trademarkDocument, name: trademarkName, kind: 'brand_rights' },
  ]));
  const logoUrl = text(input.logoUrl);
  const pageTemplate = text(input.pageTemplate || 'professional');
  const referrerBrandId = Number(input.referrerBrandId || 0) || null;
  const referrerBrandCode = text(input.referrerBrandCode).toUpperCase();
  const referrerRewardRate = Number(input.referrerRewardRate || 0);
  if (!brandName || !companyName || !contactName || !introduction) throw new Error('请完整填写品牌、公司主体、联系人和品牌简介');
  if (!categorySelection.categoryMajorId || !categorySelection.categoryMinorId) throw new Error('请选择有效的品牌大类与小类');
  if (officialWebsite && !/^https?:\/\//.test(officialWebsite)) throw new Error('官方网站必须是完整的 http 或 https 网址');
  if (socialLink && !/^https?:\/\//.test(socialLink)) throw new Error('社群链接必须是完整的 http 或 https 网址');
  if (!registrationNo) throw new Error('请填写统一社会信用代码或公司登记编号');
  if (!businessLicenseDocument && !brandDocuments.some((document) => document.kind === 'license')) throw new Error('请上传营业执照或公司设立登记文件');
  if (!phone && !wechat) throw new Error('联系电话与微信至少填写一项');
  if (phone && !/^(?:1\d{10}|[\d()+\-\s]{6,20})$/.test(phone)) throw new Error('联系电话格式不正确');
  if (!Number.isFinite(referrerRewardRate) || referrerRewardRate < 0 || referrerRewardRate > 100) throw new Error('品牌推荐分润比例必须介于 0% 至 100%');
  return {
    brandName,
    companyName,
    category,
    categoryMajorId: categorySelection.categoryMajorId,
    categoryMinorId: categorySelection.categoryMinorId,
    categoryMajorLabel: categorySelection.categoryMajorLabel,
    categoryMinorLabel: categorySelection.categoryMinorLabel,
    categoryLabel: categorySelection.categoryLabel,
    officialWebsite,
    socialLink,
    contactName,
    phone,
    wechat,
    introduction,
    registrationNo,
    legalRepresentative,
    companyType,
    registeredCapital,
    establishmentDate,
    companyAddress,
    businessScope,
    businessLicenseDocument,
    businessLicenseName,
    profileDocument,
    profileDocumentName,
    trademarkDocument,
    trademarkName,
    brandDocuments,
    logoUrl,
    pageTemplate,
    referrerBrandId,
    referrerBrandCode,
    referrerRewardRate,
  };
}

function ensureProductInput(input: Record<string, unknown>) {
  const name = text(input.name);
  const category = text(input.category);
  const description = text(input.description);
  const imageUrl = text(input.imageUrl);
  const sku = text(input.sku);
  const compareAtPrice = input.compareAtPrice === '' || input.compareAtPrice == null ? null : Number(input.compareAtPrice);
  const images = Array.isArray(input.images) ? input.images.map(text).filter(Boolean).slice(0, 12) : imageUrl ? [imageUrl] : [];
  const variantSource = Array.isArray(input.variants) ? input.variants : text(input.variantText).split('\n').map((line) => {
    const [name, values = ''] = line.split(/[:：]/, 2);
    return { name, values: values.split(/[,，]/) };
  });
  const variants = variantSource.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { name: text(row.name), values: Array.isArray(row.values) ? row.values.map(text).filter(Boolean).slice(0, 30) : [] };
  }).filter((item) => item.name && item.values.length).slice(0, 12);
  const shippingMethods = Array.isArray(input.shippingMethods) ? input.shippingMethods.map(text).filter(Boolean).slice(0, 12) : text(input.shippingMethodsText).split(/[,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const fulfillmentInfo = text(input.fulfillmentInfo);
  const priceCny = Number(input.priceCny ?? input.priceTwd);
  const supplyPriceCny = Number(input.supplyPriceCny ?? 0);
  const stockQuantity = Number(input.stockQuantity);
  const directRate = Number(input.directRate ?? 30);
  const upperRate = Number(input.upperRate ?? 5);
  const activeRate = Number(input.activeRate ?? 65);
  if (!name || !category || !description || !fulfillmentInfo) throw new Error('请完整填写商品名称、分类、说明和发货方式');
  if (!Number.isFinite(priceCny) || priceCny <= 0) throw new Error('商品售价必须大于 0');
  if (compareAtPrice != null && (!Number.isFinite(compareAtPrice) || compareAtPrice <= priceCny)) throw new Error('划线价必须高于商品售价');
  if (!Number.isFinite(supplyPriceCny) || supplyPriceCny < 0) throw new Error('品牌结算价必须大于或等于 0');
  if (supplyPriceCny >= priceCny) throw new Error('品牌结算价必须低于商品售价');
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) throw new Error('库存必须是大于或等于 0 的整数');
  if ([directRate, upperRate, activeRate].some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)) throw new Error('三段分润比例必须介于 0% 至 100%');
  if (Math.abs(directRate + upperRate + activeRate - 100) > 0.001) throw new Error('直接推荐、上层推荐与近30天销售贡献榜比例合计必须等于 100%');
  if (images.some((url) => /^data:/i.test(url))) throw new Error('商品图片不可使用浏览器 data URL，请先上传为持久图片');
  if (imageUrl && !imageUrl.startsWith('/') && !/^https?:\/\//.test(imageUrl)) throw new Error('商品图片必须是有效网址或站内路径');
  if (images.some((url) => !url.startsWith('/') && !/^https?:\/\//.test(url))) throw new Error('商品图片必须是有效网址或站内路径');
  return { name, category, description, imageUrl, images, sku, compareAtPrice, variants, shippingMethods: shippingMethods.length ? shippingMethods : [fulfillmentInfo], fulfillmentInfo, priceCny: priceCny.toFixed(2), supplyPriceCny, stockQuantity, directRate, upperRate, activeRate };
}

export function listApprovedBrands() {
  return readState().brands.filter((row) => row.status === 'approved').sort((a, b) => a.brandName.localeCompare(b.brandName, 'zh-CN'));
}

export function getApprovedBrandById(id: number) {
  return readState().brands.find((row) => row.status === 'approved' && row.id === id) || null;
}

export function getApprovedBrandBySlug(slug: string) {
  return readState().brands.find((row) => row.status === 'approved' && row.slug === slug) || null;
}

export function listBrandApplications(user: SessionUser) {
  const state = readState();
  return hasPlatformAdminAccess(user)
    ? state.brands.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : state.brands.filter((row) => row.applicantUserId === user.id || row.accountUserId === user.id || hasOrganizationMembership('brand', row.id, user.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getApprovedBrandForUser(userId: number) {
  return readState().brands.find((row) => row.status === 'approved' && (row.accountUserId === userId || row.applicantUserId === userId || hasOrganizationMembership('brand', row.id, userId))) || null;
}

export function getOwnedBrandForUser(userId: number) {
  return readState().brands.find((row) => row.status === 'approved' && (row.accountUserId === userId || row.applicantUserId === userId)) || null;
}

export function getBrandCommissionDefaults(user: SessionUser) {
  const brand = getApprovedBrandForUser(user.id);
  if (!brand) throw new Error('品牌审核通过后才能设置商品分润');
  return normalizeBrandCommissionDefaults(brand.commissionDefaults);
}

export function updateBrandCommissionDefaults(user: SessionUser, input: Record<string, unknown>) {
  const defaults = normalizeBrandCommissionDefaults(input);
  return withWrite((state) => {
    const brand = state.brands.find((row) => row.status === 'approved' && (row.accountUserId === user.id || row.applicantUserId === user.id || hasOrganizationMembership('brand', row.id, user.id)));
    if (!brand) throw new Error('品牌审核通过后才能设置商品分润');
    const isOwner = brand.accountUserId === user.id || brand.applicantUserId === user.id;
    if (!isOwner && !['admin', 'editor', 'finance'].includes(getOrganizationRole('brand', brand.id, user.id) || '')) throw new Error('当前职位无权设置商品分润');
    const now = new Date().toISOString();
    brand.commissionDefaults = { ...defaults, updatedAt: now, updatedBy: user.id };
    brand.updatedAt = now;
    audit(state, user, 'brand', brand.id, 'brand_commission_defaults_updated', `更新预设分润 ${defaults.directRate}/${defaults.upperRate}/${defaults.activeRate}`);
    return brand.commissionDefaults;
  });
}

export function saveBrandPageDraft(user: SessionUser, input: Record<string, unknown>) {
  return createBrandPagePersistence<MarketplaceState, LocalCnBrand, SessionUser>(
    { withWrite }, { findEditableBrand, audit },
  ).saveDraft(user, input);
}

export function publishBrandPage(user: SessionUser, input: Record<string, unknown>) {
  return createBrandPagePersistence<MarketplaceState, LocalCnBrand, SessionUser>(
    { withWrite }, { findEditableBrand, audit },
  ).publish(user, input);
}

export function moderateBrandPage(user: SessionUser, brandId: number, decision: 'pause' | 'request_revision' | 'restore', note: string) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可管理品牌前页');
  return withWrite((state) => {
    const brand = state.brands.find((row) => row.status === 'approved' && row.id === brandId);
    if (!brand) throw new Error('找不到审核通过的品牌');
    if (decision !== 'restore' && !note.trim()) throw new Error('请填写暂停或退回修改原因');
    const record = getBrandPageRecord(brand);
    const now = new Date().toISOString();
    const status = decision === 'pause' ? 'paused' : decision === 'request_revision' ? 'revision_requested' : record.published ? 'published' : 'draft';
    brand.brandPage = { ...record, status, moderationNote: decision === 'restore' ? '' : note.trim(), moderatedAt: now, moderatedBy: user.id };
    brand.updatedAt = now;
    audit(state, user, 'brand', brand.id, `brand_page_${decision}`, note.trim() || '恢复品牌前页');
    return brand;
  });
}

export function updateBrandPage(user: SessionUser, input: Record<string, unknown>) {
  return saveBrandPageDraft(user, input);
}

export function submitBrandApplication(user: SessionUser, input: Record<string, unknown>) {
  const normalized = ensureBrandInput(input);
  enforceStoredBrandApplicationDocumentOwnership(normalized.brandDocuments, user.id);
  return withWrite((state) => {
    const referrer = normalized.referrerBrandCode
      ? state.brands.find((row) => row.status === 'approved' && row.brandReferralCode?.toUpperCase() === normalized.referrerBrandCode)
      : normalized.referrerBrandId
        ? state.brands.find((row) => row.id === normalized.referrerBrandId && row.status === 'approved')
        : null;
    if ((normalized.referrerBrandId || normalized.referrerBrandCode) && !referrer) throw new Error('品牌招商推荐码无效，或该推荐商尚未通过审核');
    // 只有平台管理员（伺服器端检查）可以直接核准品牌；其他账号一律待平台审核（忽略客户端 autoApprove）
    const autoApprove = Boolean(input.autoApprove) && hasPlatformAdminAccess(user);
    const allowUpdatePending = Boolean(input.allowUpdatePending || autoApprove);
    const own = state.brands.find((row) => row.applicantUserId === user.id || row.accountUserId === user.id);
    if (own?.status === 'pending' && !allowUpdatePending) throw new Error('当前已有待审核的品牌申请，请勿重复提交');
    if (own?.status === 'approved' && !autoApprove) throw new Error('当前账号已经绑定审核通过的品牌');
    const duplicate = state.brands.find((row) => row.brandName.toLowerCase() === normalized.brandName.toLowerCase() && row.id !== own?.id);
    if (duplicate && !autoApprove) throw new Error('该品牌名称已经存在');
    const now = new Date().toISOString();
    const row: LocalCnBrand = own || {
      id: nextId(state.brands), slug: slugify(normalized.brandName), applicantUserId: user.id, accountUserId: null,
      status: 'pending', reviewNote: '', submittedAt: now, reviewedAt: null, reviewedBy: null, createdAt: now, updatedAt: now,
      ...normalized,
    };
    const finalStatus: BrandReviewStatus = (autoApprove || own?.status === 'approved') ? 'approved' : 'pending';
    Object.assign(row, normalized, {
      referrerBrandId: referrer?.id || null,
      referrerBrandName: referrer?.brandName || '',
      referrerBrandCode: referrer?.brandReferralCode || '',
      slug: row.slug || slugify(normalized.brandName),
      status: finalStatus,
      accountUserId: finalStatus === 'approved' ? user.id : row.accountUserId,
      brandReferralCode: finalStatus === 'approved' ? (row.brandReferralCode || `BR-${Math.abs(row.id).toString(36).toUpperCase()}`) : row.brandReferralCode,
      reviewNote: finalStatus === 'approved' ? (own?.status === 'approved' ? (row.reviewNote || '平台管理员更新') : '平台管理员直接核准') : '',
      submittedAt: now,
      reviewedAt: finalStatus === 'approved' ? (own?.status === 'approved' ? (row.reviewedAt || now) : now) : null,
      reviewedBy: finalStatus === 'approved' ? (own?.status === 'approved' ? (row.reviewedBy || user.id) : user.id) : null,
      updatedAt: now,
    });
    if (finalStatus === 'approved' && !row.brandPage) {
      row.brandPage = createBrandPageRecord(row.brandName, row.introduction, true);
    }
    if (!own) state.brands.unshift(row);
    audit(state, user, 'brand', row.id, finalStatus === 'approved' ? 'brand_approved' : (own ? 'brand_resubmitted' : 'brand_submitted'), finalStatus === 'approved' ? `${row.brandName}由平台管理员直接核准并开通品牌馆` : `${row.brandName}提交平台审核`);
    return row;
  });
}

export function reviewBrandApplication(user: SessionUser, id: number, decision: 'approved' | 'rejected', note: string, referrerRewardRate?: number) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可审核品牌');
  return withWrite((state) => {
    const row = state.brands.find((brand) => brand.id === id);
    if (!row) throw new Error('找不到品牌申请');
    if (row.status !== 'pending') throw new Error('该申请已处理，请刷新后再操作');
    if (decision === 'rejected' && !note.trim()) throw new Error('退回时必须填写原因');
    const finalRewardRate = referrerRewardRate == null ? Number(row.referrerRewardRate || 0) : Number(referrerRewardRate);
    if (!Number.isFinite(finalRewardRate) || finalRewardRate < 0 || finalRewardRate > 100) throw new Error('品牌推荐分润比例必须介于 0% 至 100%');
    const now = new Date().toISOString();
    Object.assign(row, { status: decision, brandReferralCode: decision === 'approved' ? row.brandReferralCode || `BR-${Math.abs(row.id).toString(36).toUpperCase()}` : row.brandReferralCode, referrerRewardRate: finalRewardRate, reviewNote: note.trim(), reviewedAt: now, reviewedBy: user.id, updatedAt: now, accountUserId: decision === 'approved' ? row.applicantUserId : row.accountUserId });
    if (decision === 'approved' && !row.brandPage) row.brandPage = createBrandPageRecord(row.brandName, row.introduction, false);
    audit(state, user, 'brand', row.id, decision === 'approved' ? 'brand_approved' : 'brand_rejected', note.trim() || '审核通过');
    return row;
  });
}

export function listPublicBrandProducts() {
  const state = readState();
  const approvedBrands = new Set(state.brands.filter((row) => row.status === 'approved').map((row) => row.id));
  return state.products.filter((row) => row.status === 'approved'
    && row.reviewStatus === 'approved'
    && row.isActive
    && row.salesStatus === 'active'
    && row.stockQuantity > 0
    && approvedBrands.has(row.brandId)
    && !isPlaceholderProduct(row))
    .map(({ pendingRevision: _pendingRevision, lastRevisionReview: _lastRevisionReview, ...row }) => row as LocalCnBrandProduct);
}

export function getPublicBrandProduct(id: number) {
  return listPublicBrandProducts().find((row) => row.id === id) || null;
}

export function listBrandProducts(user: SessionUser, scope: 'mine' | 'review' | 'public' = 'mine') {
  const state = readState();
  if (scope === 'public') return listPublicBrandProducts();
  if (scope === 'review') {
    if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可查看全部商品审核');
    return state.products.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const brand = state.brands.find((row) => row.status === 'approved' && (row.accountUserId === user.id || row.applicantUserId === user.id || hasOrganizationMembership('brand', row.id, user.id)));
  return brand ? state.products.filter((row) => row.brandId === brand.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
}

export function createBrandProduct(user: SessionUser, input: Record<string, unknown>) {
  return withWrite((state) => {
    const brand = state.brands.find((row) => row.status === 'approved' && (row.accountUserId === user.id || row.applicantUserId === user.id));
    const accessibleBrand = brand || state.brands.find((row) => row.status === 'approved' && hasOrganizationMembership('brand', row.id, user.id));
    if (!accessibleBrand) throw new Error('品牌审核通过后才能提交商品');
    if (!brand && !['admin', 'editor'].includes(getOrganizationRole('brand', accessibleBrand.id, user.id) || '')) throw new Error('当前职位无权提交商品');
    const defaults = normalizeBrandCommissionDefaults(accessibleBrand.commissionDefaults);
    const normalized = ensureProductInput({ ...defaults, ...input });
    // 只有平台管理员可以直接上架；其他账号一律送审（忽略客户端传入的 autoApprove）
    const autoApprove = Boolean(input.autoApprove) && hasPlatformAdminAccess(user);
    const duplicate = state.products.find((row) => row.brandId === accessibleBrand.id && row.name.toLowerCase() === normalized.name.toLowerCase() && row.status === 'pending');
    if (duplicate && !autoApprove) throw new Error('同名商品正在审核，请勿重复提交');
    const now = new Date().toISOString();
    const id = duplicate ? duplicate.id : nextId(state.products);
    const finalStatus: BrandProductStatus = autoApprove ? 'approved' : 'pending';
    const row: LocalCnBrandProduct = duplicate || {
      id, slug: slugify(normalized.name), brandId: accessibleBrand.id, brandName: accessibleBrand.brandName, ownerUserId: user.id,
      ...normalized, sku: normalized.sku || `BR-${accessibleBrand.id}-${id}`, imageIsTest: Boolean(input.imageIsTest), imageDisclosure: Boolean(input.imageIsTest) ? '商品参考图' : '',
      priceTwd: normalized.priceCny, commissionRate: text(input.commissionRate || normalized.directRate), status: finalStatus, reviewStatus: finalStatus, reviewNote: autoApprove ? 'AI Agent 智能合规核验通过并上架' : '',
      supplyPriceCny: normalized.supplyPriceCny,
      submittedAt: now, reviewedAt: autoApprove ? now : null, reviewedBy: autoApprove ? user.id : null, isActive: autoApprove, salesStatus: autoApprove ? (normalized.stockQuantity > 0 ? 'active' : 'sold_out') : 'draft', createdAt: now, updatedAt: now,
    };
    if (duplicate) {
      Object.assign(row, normalized, {
        sku: normalized.sku || row.sku,
        priceTwd: normalized.priceCny,
        commissionRate: text(input.commissionRate || normalized.directRate),
        status: finalStatus,
        reviewStatus: finalStatus,
        reviewNote: autoApprove ? 'AI Agent 智能合规核验通过并上架' : '',
        reviewedAt: autoApprove ? now : null,
        reviewedBy: autoApprove ? user.id : null,
        isActive: autoApprove,
        salesStatus: autoApprove ? (normalized.stockQuantity > 0 ? 'active' : 'sold_out') : 'draft',
        updatedAt: now,
      });
    } else {
      state.products.unshift(row);
    }
    audit(state, user, 'product', row.id, autoApprove ? 'product_approved' : 'product_submitted', autoApprove ? `${accessibleBrand.brandName}通过 AI Agent 一键上架商品「${row.name}」` : `${accessibleBrand.brandName}提交商品「${row.name}」审核`);
    return row;
  });
}

export function updateBrandProduct(user: SessionUser, id: number, action: 'resubmit' | 'edit' | 'toggle' | 'commission', input: Record<string, unknown>) {
  return withWrite((state) => {
    const row = state.products.find((product) => product.id === id);
    if (!row) throw new Error('找不到商品');
    const brand = state.brands.find((item) => item.id === row.brandId);
    const isOwner = brand && (brand.accountUserId === user.id || brand.applicantUserId === user.id);
    const allowedRoles = action === 'commission' ? ['admin', 'editor', 'finance'] : ['admin', 'editor'];
    if (!brand || (!isOwner && !allowedRoles.includes(getOrganizationRole('brand', brand.id, user.id) || ''))) throw new Error('无权修改该商品');
    const now = new Date().toISOString();
    if (action === 'commission') {
      const defaults = normalizeBrandCommissionDefaults(input);
      row.directRate = defaults.directRate;
      row.upperRate = defaults.upperRate;
      row.activeRate = defaults.activeRate;
      row.commissionRate = String(defaults.directRate);
      row.updatedAt = now;
      audit(state, user, 'product', row.id, 'product_commission_updated', `${row.name}分润更新为 ${defaults.directRate}/${defaults.upperRate}/${defaults.activeRate}`);
      return row;
    }
    if (action === 'toggle') {
      if (row.status !== 'approved') throw new Error('只有审核通过的商品可以调整销售状态');
      row.isActive = Boolean(input.isActive);
      row.salesStatus = row.isActive ? (row.stockQuantity > 0 ? 'active' : 'sold_out') : 'archived';
      row.updatedAt = now;
      audit(state, user, 'product', row.id, row.isActive ? 'product_activated' : 'product_deactivated', row.name);
      return row;
    }
    // 只有平台管理员可以把商品直接改为上架；其他账号的 autoApprove 一律忽略
    const adminApprove = Boolean(input.autoApprove) && hasPlatformAdminAccess(user);
    const allowAnyStatus = action === 'edit' || Boolean(input.allowAnyStatus || adminApprove);
    if (row.status !== 'rejected' && !allowAnyStatus) throw new Error('只有被退回的商品可以补充后重新提交');
    const normalized = ensureProductInput(input);
    const isPlatformAdmin = hasPlatformAdminAccess(user);
    if (row.status === 'approved' && !isPlatformAdmin) {
      // 非平台管理员修改已上架商品：线上版本不变，修改存为待审核修订，由平台在 /admin/products 核准或驳回
      const candidate: Record<string, unknown> = {
        ...normalized,
        sku: normalized.sku || row.sku,
        imageIsTest: Boolean(input.imageIsTest),
        imageDisclosure: Boolean(input.imageIsTest) ? '商品参考图' : '',
        priceTwd: normalized.priceCny,
      };
      const current = row as unknown as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(candidate)) {
        const was = current[key];
        const same = JSON.stringify(value ?? null) === JSON.stringify(was ?? null)
          || (key === 'images' && Array.isArray(value) && value.length === 0 && was == null);
        if (!same) { fields[key] = value; before[key] = was ?? null; }
      }
      if (!Object.keys(fields).length) {
        if (row.pendingRevision) { row.pendingRevision = null; row.updatedAt = now; audit(state, user, 'product', row.id, 'product_revision_withdrawn', `${row.name}修改与线上版本相同，撤回待审核修订`); }
        return row;
      }
      row.pendingRevision = { fields, before, submittedAt: now, submittedBy: user.id, submittedByName: user.name || '' };
      row.updatedAt = now;
      audit(state, user, 'product', row.id, 'product_revision_submitted', `${row.name}提交修改审核（${Object.keys(fields).join('、')}），线上版本保持不变`);
      return row;
    }
    const keepApproved = adminApprove || (isPlatformAdmin && row.status === 'approved');
    Object.assign(row, normalized, {
      sku: normalized.sku || row.sku,
      imageIsTest: Boolean(input.imageIsTest),
      imageDisclosure: Boolean(input.imageIsTest) ? '商品参考图' : '',
      priceTwd: normalized.priceCny,
      status: keepApproved ? 'approved' : 'pending',
      reviewStatus: keepApproved ? 'approved' : 'pending',
      reviewNote: keepApproved ? (row.reviewNote || 'AI Agent 智能合规核验通过并上架') : '',
      submittedAt: now,
      reviewedAt: keepApproved ? (row.reviewedAt || now) : null,
      reviewedBy: keepApproved ? (row.reviewedBy || user.id) : null,
      isActive: keepApproved ? (row.isActive !== false) : false,
      salesStatus: keepApproved ? (normalized.stockQuantity > 0 ? 'active' : 'sold_out') : 'draft',
      updatedAt: now,
    });
    audit(state, user, 'product', row.id, keepApproved ? 'product_updated' : 'product_resubmitted', keepApproved ? `${row.name}通过编辑器更新并保持上架` : `${row.name}重新提交审核`);
    return row;
  });
}

export function reviewBrandProduct(user: SessionUser, id: number, decision: 'approved' | 'rejected', note: string) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可审核商品');
  return withWrite((state) => {
    const row = state.products.find((product) => product.id === id);
    if (!row) throw new Error('找不到商品');
    if (row.status !== 'pending') throw new Error('该商品已处理，请刷新后再操作');
    if (decision === 'rejected' && !note.trim()) throw new Error('退回时必须填写原因');
    const now = new Date().toISOString();
    Object.assign(row, { status: decision, reviewStatus: decision, reviewNote: note.trim(), reviewedAt: now, reviewedBy: user.id, isActive: decision === 'approved', salesStatus: decision === 'approved' ? (row.stockQuantity > 0 ? 'active' : 'sold_out') : 'draft', updatedAt: now });
    audit(state, user, 'product', row.id, decision === 'approved' ? 'product_approved' : 'product_rejected', note.trim() || '审核通过并上架');
    return row;
  });
}

export function reviewBrandProductRevision(user: SessionUser, id: number, decision: 'approved' | 'rejected', note: string) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可审核商品修改');
  return withWrite((state) => {
    const row = state.products.find((product) => product.id === id);
    if (!row) throw new Error('找不到商品');
    const revision = row.pendingRevision;
    if (!revision || !revision.fields || !Object.keys(revision.fields).length) throw new Error('该商品没有待审核的修改，请刷新后再操作');
    if (decision === 'rejected' && !note.trim()) throw new Error('驳回修改时必须填写原因');
    const now = new Date().toISOString();
    const changed = Object.keys(revision.fields);
    if (decision === 'approved') {
      Object.assign(row, revision.fields);
      if (row.isActive && row.status === 'approved') row.salesStatus = row.stockQuantity > 0 ? 'active' : 'sold_out';
    }
    row.pendingRevision = null;
    row.lastRevisionReview = { decision, note: note.trim(), reviewedAt: now, reviewedBy: user.id };
    row.updatedAt = now;
    audit(state, user, 'product', row.id, decision === 'approved' ? 'product_revision_approved' : 'product_revision_rejected', decision === 'approved' ? `${row.name}修改审核通过并套用（${changed.join('、')}）` : `${row.name}修改被驳回：${note.trim()}`);
    return row;
  });
}

export function listBrandMarketplaceAudits(user: SessionUser) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可查看审核记录');
  return readState().audits;
}
