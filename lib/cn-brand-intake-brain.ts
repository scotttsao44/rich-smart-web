import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SessionUser } from './auth';
import {
  BRAND_QUALIFICATION_DOCUMENT_LABELS,
  findBrandCategoryMinor,
  suggestBrandCategoriesFromBusinessScope,
  type BrandCategorySuggestion,
  type BrandQualificationDocumentKind,
} from './cn-brand-taxonomy';
import { brandDraftFromDocumentText } from './cn-brand-document';
import { isRecognizedCompanyDocument, isUnifiedSocialCreditCode, parseBusinessLicenseText, type BusinessLicenseOcrResult } from './cn-business-license-ocr';
import { findActivePdfMarker } from './pdf-safety';
import { UploadValidationError } from './pdf-upload-bytes';
import { identifyBrandDocument, type DocumentIdentification, type DocumentTextPage, type IntakeDocumentKind } from './cn-brand-document-identification';
export type { IntakeDocumentKind } from './cn-brand-document-identification';

export type IntakeChecklistStatus = 'missing' | 'ai_processing' | 'needs_confirmation' | 'incomplete' | 'conflict' | 'confirmed' | 'reviewing' | 'approved' | 'rejected';
export type IntakeRequirementPhase = 'base_required' | 'category_required' | 'product_launch_required' | 'optional';
export type IntakeEntityType = 'company' | 'brand' | 'product' | 'license' | 'document';
export type IntakeValidationStatus = 'ai_suggested' | 'needs_confirmation' | 'confirmed' | 'conflict' | 'rejected';

export type IntakeProvenance = {
  sourceFileId: string;
  sourceFileName: string;
  page?: number;
  region?: { x: number; y: number; width: number; height: number };
  rawText: string;
  extractedValue: string;
  confidence: number;
  extractor: 'deterministic' | 'ocr' | 'table' | 'image_understanding' | 'user';
  validationStatus: IntakeValidationStatus;
};

export type IntakeFieldDraft = {
  value: string;
  confidence: number;
  validationStatus: IntakeValidationStatus;
  sources: IntakeProvenance[];
  conflicts?: IntakeProvenance[];
  userConfirmedValue?: string;
  confirmedAt?: string;
  confirmedBy?: number;
};

export type IntakeProductDraft = {
  id: string;
  title: IntakeFieldDraft;
  fields: Record<string, IntakeFieldDraft>;
  images: string[];
  variants: Array<{ name: string; value: string; sourceFileId: string }>;
  status: IntakeChecklistStatus;
  createdAt: string;
  updatedAt: string;
};

export type IntakeFileRecord = {
  id: string;
  token: string;
  brandId: number | null;
  memberId: number;
  originalName: string;
  size: number;
  declaredMime: string;
  detectedMime: string;
  sha256: string;
  kind: IntakeDocumentKind;
  status: IntakeChecklistStatus;
  pageCount?: number;
  identification?: DocumentIdentification;
  documentDraft?: Record<string, IntakeFieldDraft & { role: string }>;
  companyDraft?: Record<string, IntakeFieldDraft>;
  companyContentMatched?: boolean;
  companyOwnerStatus?: 'owner_confirmation_required' | 'matching_current_owner' | 'conflict' | 'unverified';
  manualKind?: IntakeDocumentKind;
  duplicateOf?: string;
  relatedFiles?: string[];
  assetCandidate?: { usage: 'unverified_visual'; generatedFilenameHint: boolean; needsReview: true };
  coverage?: { textPages: number[]; ocrAttemptedPages: number[]; unreadPages: number[] };
  applicationAttachment?: { token: string; name: string; kind: 'license'; size: number; verificationStatus: 'manual_review'; sourceFileId: string; sourceSha256: string; sourcePage: number; sourceMode: 'copy' | 'legal-page-render' };
  warnings: string[];
  rejectedReason?: string;
  extractedTextPreview: string;
  createdAt: string;
};

export type IntakeChecklistItem = {
  id: string;
  phase: IntakeRequirementPhase;
  label: string;
  why: string;
  canBackfillWhen: string;
  status: IntakeChecklistStatus;
  requiredDocumentKinds: IntakeDocumentKind[];
  relatedQualificationKind?: BrandQualificationDocumentKind;
  missingFields?: string[];
};

export type BrandIntakeState = {
  memberId: number;
  brandId: number | null;
  company: Record<string, IntakeFieldDraft>;
  brand: Record<string, IntakeFieldDraft>;
  licenses: Record<string, IntakeFieldDraft>;
  productDrafts: IntakeProductDraft[];
  files: IntakeFileRecord[];
  checklist: IntakeChecklistItem[];
  categorySuggestions: BrandCategorySuggestion[];
  audit: Array<{ id: string; action: string; actorId: number; detail: string; createdAt: string }>;
  aiUsageMetering: {
    deterministicRuns: number;
    paidAiRuns: number;
    lastQuote?: unknown;
    testModeNoCharge: boolean;
    message: string;
  };
  updatedAt: string;
};

type IntakeStore = {
  schemaVersion: 1;
  revision: number;
  states: BrandIntakeState[];
};

export type IntakeUploadInput = {
  user: SessionUser;
  brandId?: number | null;
  fileName: string;
  declaredMime: string;
  bytes: Uint8Array;
  documentType?: string;
  extractedText?: string;
  pageCount?: number;
  pages?: DocumentTextPage[];
  processingWarnings?: string[];
  coverage?: IntakeFileRecord['coverage'];
  businessLicenseOcr?: BusinessLicenseOcrResult | null;
  aiQuote?: unknown;
};

const SUPPORTED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'text/plain',
]);
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_PDF_PAGES = 120;
const ACTIVE_PDF_MARKERS = ['/JavaScript', '/JS', '/OpenAction', '/AA', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA'];

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

export function intakeDocumentDirectory() {
  return path.join(dataDir(), 'brand-intake-documents');
}

function dataFile() {
  return path.join(dataDir(), 'cn-brand-intake-brain.json');
}

function lockFile() {
  return `${dataFile()}.lock`;
}

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix: string) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function compact(value: string) {
  return text(value).replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ');
}

function emptyStore(): IntakeStore {
  return { schemaVersion: 1, revision: 1, states: [] };
}

function normalizeStore(value: unknown): IntakeStore {
  const row = value && typeof value === 'object' ? value as Partial<IntakeStore> : {};
  return { schemaVersion: 1, revision: Number(row.revision || 1), states: Array.isArray(row.states) ? row.states as BrandIntakeState[] : [] };
}

function readStore(): IntakeStore {
  if (!existsSync(dataFile())) return emptyStore();
  try {
    return normalizeStore(JSON.parse(readFileSync(dataFile(), 'utf8')));
  } catch {
    return emptyStore();
  }
}

function writeStore(store: IntakeStore) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${dataFile()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...store, revision: store.revision + 1 }, null, 2));
  renameSync(temporary, dataFile());
}

function withWrite<T>(operation: (store: IntakeStore) => T): T {
  mkdirSync(dataDir(), { recursive: true });
  let descriptor: number | null = null;
  const deadline = Date.now() + 3000;
  while (descriptor === null) {
    try {
      descriptor = openSync(lockFile(), 'wx');
    } catch (error: any) {
      if (error?.code !== 'EEXIST' || Date.now() > deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    const store = readStore();
    const result = operation(store);
    writeStore(store);
    return result;
  } finally {
    closeSync(descriptor);
    rmSync(lockFile(), { force: true });
  }
}

function detectMime(bytes: Uint8Array, declaredMime: string, fileName = '') {
  const name = fileName.toLowerCase();
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const zipHint = Buffer.from(bytes.slice(0, Math.min(bytes.length, 1_500_000))).toString('latin1');
    if (zipHint.includes('word/') || name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (zipHint.includes('xl/') || name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/zip';
  }
  const sample = Buffer.from(bytes.slice(0, Math.min(bytes.length, 4096))).toString('utf8');
  if ((declaredMime === 'text/csv' || name.endsWith('.csv')) && /[,，;\t]/.test(sample)) return 'text/csv';
  if (declaredMime === 'text/plain') return 'text/plain';
  return 'application/octet-stream';
}

export function validateIntakeFileEnvelope(input: { bytes: Uint8Array; declaredMime: string; fileName?: string; pageCount?: number }) {
  const detectedMime = detectMime(input.bytes, input.declaredMime, input.fileName);
  const warnings: string[] = [];
  if (!input.bytes.length) throw new UploadValidationError('文件为空，请上传原始资料文件');
  if (input.bytes.length > MAX_FILE_SIZE) throw new UploadValidationError('单个资料文件不可超过 12 MB');
  if (!SUPPORTED_MIME.has(detectedMime)) throw new UploadValidationError('目前仅支持 PDF、JPG、PNG、WebP、DOCX、XLSX、CSV');
  if (input.declaredMime && SUPPORTED_MIME.has(input.declaredMime) && input.declaredMime !== detectedMime) {
    if (!(input.declaredMime === 'application/csv' && detectedMime === 'text/csv')) throw new UploadValidationError('文件内容与 MIME 不一致，请上传原始文件');
  }
  if (detectedMime === 'application/pdf') {
    if (Number(input.pageCount || 0) > MAX_PDF_PAGES) throw new UploadValidationError(`PDF 超过 ${MAX_PDF_PAGES} 页，请拆分后上传`);
    const source = Buffer.from(input.bytes).toString('latin1');
    const marker = findActivePdfMarker(source, ACTIVE_PDF_MARKERS);
    if (marker) throw new UploadValidationError(`PDF 含有不允许的主动内容（${marker}），请上传静态扫描件或正式电子文件`);
  }
  if (detectedMime.includes('officedocument')) {
    const source = Buffer.from(input.bytes.slice(0, Math.min(input.bytes.length, 2_000_000))).toString('latin1');
    if (source.includes('../') || source.includes('..\\')) throw new UploadValidationError('Office 文件包含不安全路径，请另存为干净文件后上传');
    if (source.includes('vbaProject.bin')) warnings.push('文件可能含有宏，已仅保存为待人工确认资料，不会执行任何内容。');
  }
  return { detectedMime, warnings };
}

export function classifyIntakeDocument(fileName: string, detectedMime: string, extractedText = '', documentType = ''): IntakeDocumentKind {
  void documentType;
  return identifyBrandDocument(fileName, detectedMime, [{ page: 1, text: extractedText, extractor: 'deterministic' }]).kind;
}

function provenance(file: IntakeFileRecord, rawText: string, value: string, confidence: number, extractor: IntakeProvenance['extractor'], status: IntakeValidationStatus = 'needs_confirmation'): IntakeProvenance {
  return {
    sourceFileId: file.id,
    sourceFileName: file.originalName,
    rawText: rawText.slice(0, 1000),
    extractedValue: value,
    confidence,
    extractor,
    validationStatus: status,
  };
}

function field(value: string, source: IntakeProvenance): IntakeFieldDraft {
  return { value, confidence: source.confidence, validationStatus: source.validationStatus, sources: [source] };
}

function mergeField(current: IntakeFieldDraft | undefined, incoming: IntakeFieldDraft): IntakeFieldDraft {
  if (!current) return incoming;
  if (current.userConfirmedValue && current.userConfirmedValue !== incoming.value) {
    return { ...current, conflicts: [...(current.conflicts || []), ...incoming.sources], validationStatus: 'conflict' };
  }
  if (current.value && incoming.value && current.value !== incoming.value) {
    return {
      ...current,
      conflicts: [...(current.conflicts || []), ...incoming.sources],
      confidence: Math.max(current.confidence, incoming.confidence),
      validationStatus: 'conflict',
    };
  }
  return {
    ...current,
    value: current.value || incoming.value,
    confidence: Math.max(current.confidence, incoming.confidence),
    sources: [...current.sources, ...incoming.sources],
  };
}

function addFields(target: Record<string, IntakeFieldDraft>, file: IntakeFileRecord, draft: Record<string, unknown>, extractor: IntakeProvenance['extractor'], confidence?: Partial<Record<string, number>>, evidence?: BusinessLicenseOcrResult['fieldEvidence']) {
  for (const [key, raw] of Object.entries(draft)) {
    const value = compact(String(raw || ''));
    if (!value) continue;
    const source = provenance(file, value, value, confidence?.[key] ?? (extractor === 'ocr' ? 0.78 : 0.68), extractor);
    const rawEvidence = evidence?.[key as keyof typeof evidence];
    const incoming = field(value, source);
    if (rawEvidence?.length) incoming.sources = rawEvidence.map((item) => ({
      ...source, rawText: item.text, confidence: item.confidence, page: item.page, ...(item.box ? { region: item.box } : {}),
    }));
    target[key] = mergeField(target[key], incoming);
  }
}

function matchLine(textBlock: string, expressions: RegExp[]) {
  for (const expression of expressions) {
    const match = textBlock.match(expression);
    if (match?.[1]) return compact(match[1]);
  }
  return '';
}

function productKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 80);
}

function extractProductBlocks(extractedText: string) {
  const normalized = extractedText.replace(/\r/g, '\n');
  const blocks = normalized.split(/\n(?=(?:商品名|产品名称|品名|SKU|条码|型号|规格)[：:])/).map((item) => item.trim()).filter((item) => item.length >= 8);
  return blocks.length > 1 ? blocks : normalized.split(/\n{2,}/).map((item) => item.trim()).filter((item) => /商品|产品|SKU|价格|型号|规格/.test(item));
}

function productFieldsFromBlock(block: string) {
  const title = matchLine(block, [/(?:商品名|产品名称|品名|名称)[：:]\s*([^\n，,；;]{2,80})/i]) || block.split('\n').find((line) => line.trim().length >= 2)?.trim().slice(0, 80) || '未命名商品草稿';
  const fields: Record<string, string> = {
    sku: matchLine(block, [/(?:SKU|货号|条码|barcode)[：:]\s*([A-Z0-9\-_]{3,64})/i]),
    spec: matchLine(block, [/(?:规格|型号|model)[：:]\s*([^\n；;]{1,120})/i]),
    price: matchLine(block, [/(?:价格|售价|报价|price)[：:]\s*(?:¥|￥|RMB)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i]),
    stock: matchLine(block, [/(?:库存|stock)[：:]\s*([0-9]+)/i]),
    ingredients: matchLine(block, [/(?:成分|配料|材料|ingredient)[：:]\s*([^\n]{2,260})/i]),
    claimsRaw: matchLine(block, [/(?:功能|卖点|功效|claim)[：:]\s*([^\n]{2,260})/i]),
    usage: matchLine(block, [/(?:使用方法|用法|usage)[：:]\s*([^\n]{2,260})/i]),
    warning: matchLine(block, [/(?:警示|注意事项|warning)[：:]\s*([^\n]{2,260})/i]),
    shelfLife: matchLine(block, [/(?:保质期|有效期|shelf\s*life)[：:]\s*([^\n]{1,80})/i]),
    origin: matchLine(block, [/(?:产地|原产国|origin)[：:]\s*([^\n]{1,80})/i]),
    manufacturer: matchLine(block, [/(?:生产商|制造商|manufacturer)[：:]\s*([^\n]{2,120})/i]),
    permitNo: matchLine(block, [/(?:许可证号|备案号|注册证号)[：:]\s*([A-Z0-9\u4e00-\u9fa5\-_()（）]{4,80})/i]),
  };
  return { title, fields: Object.fromEntries(Object.entries(fields).filter(([, value]) => value)) };
}

function mergeProductDrafts(products: IntakeProductDraft[], file: IntakeFileRecord, extractedText: string, pageNumber = 1) {
  const blocks = extractProductBlocks(extractedText);
  for (const block of blocks) {
    const parsed = productFieldsFromBlock(block);
    const key = productKey(parsed.fields.sku || parsed.title);
    let product = products.find((item) => productKey(item.fields.sku?.value || item.title.value) === key);
    const titleSource = { ...provenance(file, block, parsed.title, 0.64, file.kind === 'spreadsheet' ? 'table' : 'deterministic'), page: pageNumber };
    if (!product) {
      product = { id: nextId('PD-'), title: field(parsed.title, titleSource), fields: {}, images: [], variants: [], status: 'needs_confirmation', createdAt: nowIso(), updatedAt: nowIso() };
      products.push(product);
    } else {
      product.title = mergeField(product.title, field(parsed.title, titleSource));
      product.updatedAt = nowIso();
    }
    for (const [fieldName, value] of Object.entries(parsed.fields)) {
      const source = { ...provenance(file, block, value, fieldName === 'stock' ? 0.7 : 0.62, file.kind === 'spreadsheet' ? 'table' : 'deterministic'), page: pageNumber };
      product.fields[fieldName] = mergeField(product.fields[fieldName], field(value, source));
    }
    product.status = Object.values(product.fields).some((item) => item.validationStatus === 'conflict') || product.title.validationStatus === 'conflict' ? 'conflict' : 'needs_confirmation';
  }
}

function checklistFor(state: BrandIntakeState, categoryMajorId?: unknown, categoryMinorId?: unknown): IntakeChecklistItem[] {
  const filesByKind = new Set(state.files.filter((file) => !file.rejectedReason).map((file) => file.kind));
  if (state.files.some(file => file.companyContentMatched && !file.rejectedReason)) filesByKind.add('business_license');
  const hasCompanyRequired = ['companyName', 'registrationNo'].every((key) => Boolean(state.company[key]?.value));
  const hasBrandRequired = Boolean(state.brand.brandName?.value || state.brand.introduction?.value);
  const items: IntakeChecklistItem[] = [
    {
      id: 'base-company',
      phase: 'base_required',
      label: '公司主体与营业执照',
      why: '平台需要确认签约主体、统一社会信用代码、法人/地址与经营范围。',
      canBackfillWhen: '正式品牌申请送出前必须补齐；测试邀请首次登录不需要。',
      status: hasCompanyRequired && filesByKind.has('business_license') ? 'needs_confirmation' : filesByKind.has('business_license') ? 'incomplete' : 'missing',
      requiredDocumentKinds: ['business_license'],
      missingFields: ['companyName', 'registrationNo', 'legalRepresentative', 'companyAddress', 'businessScope'].filter((key) => !state.company[key]?.value),
    },
    {
      id: 'base-brand',
      phase: 'base_required',
      label: '品牌名称、介绍与权利资料',
      why: '平台需要知道品牌对外展示内容和商标/授权链，避免误用他人品牌。',
      canBackfillWhen: '送出品牌审核前需至少确认品牌名称；商标/授权可按平台退件意见补充。',
      status: hasBrandRequired ? 'needs_confirmation' : 'missing',
      requiredDocumentKinds: ['trademark_certificate', 'company_profile', 'brand_manual'],
      missingFields: ['brandName', 'introduction'].filter((key) => !state.brand[key]?.value),
    },
    {
      id: 'product-launch',
      phase: 'product_launch_required',
      label: '商品型录、图片、规格、价格与合规资料',
      why: '商品只能建立草稿，发布前必须核对价格、库存、宣称、许可与图片来源。',
      canBackfillWhen: '品牌审核可先送出；上架具体商品时必须补齐并人工审核。',
      status: state.productDrafts.length ? (state.productDrafts.some((item) => item.status === 'conflict') ? 'conflict' : 'needs_confirmation') : 'missing',
      requiredDocumentKinds: ['product_catalog', 'product_image', 'ingredient_spec', 'price_list', 'inspection_report', 'license_permit'],
    },
    {
      id: 'optional-public-links',
      phase: 'optional',
      label: '官网、公开链接与品牌素材',
      why: '经品牌明确授权后，可用公开内容辅助补齐介绍和商品草稿。',
      canBackfillWhen: '任何时候都可以补充；系统不得绕过登录、验证码、robots 或抓取非授权个人资料。',
      status: 'missing',
      requiredDocumentKinds: ['company_profile', 'brand_manual'],
    },
  ];
  const match = findBrandCategoryMinor(categoryMajorId, categoryMinorId);
  if (match) {
    for (const qualification of match.minor.qualificationDocuments) {
      const mappedKind: IntakeDocumentKind = qualification === 'business_license'
        ? 'business_license'
        : qualification === 'brand_rights'
          ? 'trademark_certificate'
          : qualification === 'quality_report'
            ? 'inspection_report'
            : 'license_permit';
      items.splice(items.length - 2, 0, {
        id: `category-${qualification}`,
        phase: 'category_required',
        label: BRAND_QUALIFICATION_DOCUMENT_LABELS[qualification],
        why: match.minor.qualificationNote,
        canBackfillWhen: qualification === 'business_license' || qualification === 'brand_rights' ? '正式品牌申请送出前需提供。' : '可先列为缺失，平台审核或商品上架前按类目要求补齐。',
        status: filesByKind.has(mappedKind) ? 'needs_confirmation' : 'missing',
        requiredDocumentKinds: [mappedKind],
        relatedQualificationKind: qualification,
      });
    }
  }
  return items.map((item) => {
    if (item.status === 'needs_confirmation') {
      const hasConflict = Object.values(state.company).concat(Object.values(state.brand), Object.values(state.licenses)).some((field) => field.validationStatus === 'conflict');
      return hasConflict && item.phase !== 'optional' ? { ...item, status: 'conflict' } : item;
    }
    return item;
  });
}

function findOrCreateState(store: IntakeStore, user: SessionUser, brandId?: number | null) {
  const normalizedBrandId = Number(brandId || 0) || null;
  let state = store.states.find((item) => item.memberId === user.id && (item.brandId || null) === normalizedBrandId);
  if (!state) {
    state = {
      memberId: user.id,
      brandId: normalizedBrandId,
      company: {},
      brand: {},
      licenses: {},
      productDrafts: [],
      files: [],
      checklist: [],
      categorySuggestions: [],
      audit: [],
      aiUsageMetering: {
        deterministicRuns: 0,
        paidAiRuns: 0,
        testModeNoCharge: process.env.NODE_ENV !== 'production',
        message: '确定性解析不扣 AI 费用；正式 AI 推理仅在显示预估消耗并由品牌确认后才会接入 ledger。',
      },
      updatedAt: nowIso(),
    };
    state.checklist = checklistFor(state);
    store.states.push(state);
  }
  return state;
}

export function getBrandIntakeState(user: SessionUser, brandId?: number | null, category?: { categoryMajorId?: unknown; categoryMinorId?: unknown }) {
  const store = readStore();
  const state = findOrCreateState(store, user, brandId);
  return { ...state, checklist: checklistFor(state, category?.categoryMajorId, category?.categoryMinorId) };
}

function documentDraft(file: IntakeFileRecord, identification: DocumentIdentification) {
  return Object.fromEntries(Object.entries(identification.fields).map(([key, candidate]) => {
    const sources = candidate.sources.map(source => ({ ...provenance(file, source.rawText, candidate.value, source.confidence, source.extractor), page: source.page }));
    return [key, { value: candidate.value, role: candidate.role, confidence: Math.min(...sources.map(source => source.confidence)), sources, validationStatus: candidate.conflict ? 'conflict' as const : 'needs_confirmation' as const }];
  }));
}

function companyCandidate(file: IntakeFileRecord, pages: DocumentTextPage[], recognized?: BusinessLicenseOcrResult | null) {
  const draft: Record<string, IntakeFieldDraft> = {};
  let matched = false;
  const parsed = recognized ? [{ page: 1, ocr: recognized }] : pages.map(page => ({ page: page.page, ocr: parseBusinessLicenseText(page.text, page.extractor === 'ocr' ? 'local-tesseract' : 'pdf-text', page.lines || []) }));
  for (const { page, ocr } of parsed) {
    if (!isRecognizedCompanyDocument(ocr)) continue;
    matched = true;
    const evidence = Object.fromEntries(Object.entries(ocr.fieldEvidence || {}).map(([field, sources]) => [field, sources?.map(source => ({ ...source, page }))])) as BusinessLicenseOcrResult['fieldEvidence'];
    addFields(draft, file, ocr.draft as Record<string, unknown>, ocr.provider === 'pdf-text' ? 'deterministic' : 'ocr', ocr.confidence, evidence);
    file.warnings.push(...ocr.lowConfidenceFields.map(field => `${field} 信心度偏低，仅保留候选，未自动填入。`));
  }
  return { draft, matched };
}

function sameIdentity(left: string, right: string) { return left.replace(/\s/g, '').toUpperCase() === right.replace(/\s/g, '').toUpperCase(); }

function companyOwnerStatus(state: BrandIntakeState, draft: Record<string, IntakeFieldDraft>): NonNullable<IntakeFileRecord['companyOwnerStatus']> {
  if (!draft.companyName || !draft.registrationNo) return 'unverified';
  if ([draft.companyName, draft.registrationNo].some(field => field.validationStatus === 'conflict')) return 'conflict';
  const ownerNo = state.company.registrationNo?.userConfirmedValue;
  const ownerName = state.company.companyName?.userConfirmedValue;
  if (!ownerNo || !ownerName) return 'owner_confirmation_required';
  return sameIdentity(ownerNo, draft.registrationNo.value) && sameIdentity(ownerName, draft.companyName.value) ? 'matching_current_owner' : 'conflict';
}

function referenceNumbers(file: IntakeFileRecord) {
  return Object.entries(file.documentDraft || {}).filter(([key, field]) => /No$/.test(key) && field.role === 'document' && field.validationStatus !== 'conflict')
    .map(([, field]) => field.value.replace(/\s/g, '').toUpperCase()).filter(value => value.length >= 5);
}

export function saveBrandIntakeUpload(input: IntakeUploadInput, category?: { categoryMajorId?: unknown; categoryMinorId?: unknown }) {
  const envelope = validateIntakeFileEnvelope({ bytes: input.bytes, declaredMime: input.declaredMime, fileName: input.fileName, pageCount: input.pageCount });
  return withWrite((store) => {
    const state = findOrCreateState(store, input.user, input.brandId);
    const sha256 = crypto.createHash('sha256').update(Buffer.from(input.bytes)).digest('hex');
    const duplicate = state.files.find((file) => file.sha256 === sha256);
    const extractedText = compact(input.extractedText || '');
    const recognizedOcr = input.businessLicenseOcr && isRecognizedCompanyDocument(input.businessLicenseOcr) ? input.businessLicenseOcr : null;
    const legacyOcrText = recognizedOcr ? [...(recognizedOcr.titleSignals || []), ...Object.values(recognizedOcr.fieldEvidence || {}).flatMap(sources => sources?.map(source => source.text) || [])].join('\n') : '';
    const pages = input.pages || [{ page: 1, text: extractedText || legacyOcrText, extractor: recognizedOcr && !extractedText ? 'ocr' as const : 'deterministic' as const }];
    const identification = identifyBrandDocument(input.fileName, envelope.detectedMime, pages);
    const kind = identification.kind;
    const extension = envelope.detectedMime === 'application/pdf' ? 'pdf'
      : envelope.detectedMime === 'image/png' ? 'png'
        : envelope.detectedMime === 'image/webp' ? 'webp'
          : envelope.detectedMime === 'image/jpeg' ? 'jpg'
            : envelope.detectedMime.includes('wordprocessing') ? 'docx'
              : envelope.detectedMime.includes('spreadsheet') ? 'xlsx'
                : 'csv';
    const token = `intake-${input.user.id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
    mkdirSync(intakeDocumentDirectory(), { recursive: true });
    writeFileSync(path.join(intakeDocumentDirectory(), token), Buffer.from(input.bytes));
    const file: IntakeFileRecord = {
      id: nextId('IF-'),
      token,
      brandId: state.brandId,
      memberId: input.user.id,
      originalName: input.fileName,
      size: input.bytes.length,
      declaredMime: input.declaredMime,
      detectedMime: envelope.detectedMime,
      sha256,
      kind,
      status: kind === 'unknown' ? 'needs_confirmation' : 'needs_confirmation',
      pageCount: input.pageCount,
      identification,
      coverage: input.coverage,
      ...(duplicate ? { duplicateOf: duplicate.id } : {}),
      warnings: [...envelope.warnings, ...identification.warnings, ...(input.processingWarnings || [])],
      extractedTextPreview: identification.sensitivePages.length || kind === 'unknown' ? '' : extractedText.slice(0, 1200),
      createdAt: nowIso(),
    };
    file.documentDraft = documentDraft(file, identification);
    const refs = referenceNumbers(file);
    file.relatedFiles = state.files.filter(existing => referenceNumbers(existing).some(value => refs.includes(value))).map(existing => existing.id);
    for (const existing of state.files.filter(existing => file.relatedFiles?.includes(existing.id))) existing.relatedFiles = Array.from(new Set([...(existing.relatedFiles || []), file.id]));
    if (envelope.detectedMime.startsWith('image/') && ['unknown', 'visual_asset'].includes(kind)) file.assetCandidate = { usage: 'unverified_visual', generatedFilenameHint: /generated|gemini|生成/i.test(input.fileName), needsReview: true };
    state.files.unshift(file);
    state.aiUsageMetering.deterministicRuns += 1;
    state.aiUsageMetering.lastQuote = input.aiQuote;

    const legalCompanyPages = pages.filter(page => identification.pageKinds.some(item => item.page === page.page && ['business_license', 'company_registration'].includes(item.kind)));
    if (legalCompanyPages.length) {
      const candidate = companyCandidate(file, legalCompanyPages, recognizedOcr);
      file.companyDraft = candidate.draft;
      file.companyContentMatched = candidate.matched;
      file.companyOwnerStatus = companyOwnerStatus(state, candidate.draft);
      // OCR confidence is not field correctness; even a matching owner's details require explicit review.
      file.warnings.push('公司资料仅保留在此文件候选中；请确认公司主体并逐项核对细节，不能仅凭识别分数自动填入申请。');
    } else if (!duplicate && ['company_profile', 'brand_manual', 'trademark_certificate'].includes(kind) && extractedText) {
      const draft = brandDraftFromDocumentText(extractedText, kind);
      addFields(state.brand, file, { brandName: draft.brandName, introduction: draft.introduction, contactName: draft.contactName, phone: draft.phone }, 'deterministic');
    }

    if (!duplicate && ['product_catalog', 'price_list', 'ingredient_spec', 'spreadsheet'].includes(kind) && extractedText) {
      for (const page of pages.filter(page => !identification.sensitivePages.includes(page.page))) mergeProductDrafts(state.productDrafts, file, page.text, page.page);
    }
    state.checklist = checklistFor(state, category?.categoryMajorId, category?.categoryMinorId);
    state.updatedAt = nowIso();
    state.audit.unshift({ id: nextId('IA-'), action: duplicate ? 'archived_duplicate_file' : 'intake_file_processed', actorId: input.user.id, detail: duplicate ? `${input.fileName} 原件仍已归档，内容重复于 ${duplicate.originalName}，未重复合并商品草稿。` : `${input.fileName} 分类为 ${kind}，每份资料候选分别等待确认。`, createdAt: nowIso() });
    return { state, file, duplicate: Boolean(duplicate) };
  });
}

export function confirmIntakeCompanyDocument(user: SessionUser, input: { brandId?: number | null; fileId: string; companyName?: string; registrationNo?: string }) {
  return withWrite(store => {
    const state = findOrCreateState(store, user, input.brandId);
    const file = state.files.find(file => file.id === input.fileId && file.memberId === user.id);
    if (!file || file.manualKind === 'sensitive_document' || !file.companyContentMatched || !file.companyDraft) throw new Error('只能从本账户内已识别的合法公司文件确认主体');
    const name = text(input.companyName || file.companyDraft?.companyName?.value);
    const code = text(input.registrationNo || file.companyDraft?.registrationNo?.value).toUpperCase();
    if (name.length < 2 || !isUnifiedSocialCreditCode(code) || !sameIdentity(code, file.companyDraft?.registrationNo?.value || '')) throw new Error('公司名称或统一代码需要与原件核对');
    if (state.company.registrationNo?.userConfirmedValue && !sameIdentity(state.company.registrationNo.userConfirmedValue, code)) throw new Error('当前已确认的主体不同，不能自动替换；请联系平台核对');
    if (state.company.companyName?.userConfirmedValue && !sameIdentity(state.company.companyName.userConfirmedValue, name)) throw new Error('当前已确认的公司名称不同，请联系平台核对，不能覆盖人工值');
    for (const [key, value] of Object.entries({ companyName: name, registrationNo: code })) {
      const candidate = file.companyDraft?.[key];
      if (!candidate?.sources.length || candidate.validationStatus === 'conflict') throw new Error('此字段缺少单一明确来源，请核对原件');
      const source = provenance(file, '用户明确确认公司主体候选', value, 1, 'user', 'confirmed');
      const confirmed: IntakeFieldDraft = { ...candidate, value, confidence: 1, userConfirmedValue: value, sources: [...candidate.sources, source], validationStatus: 'confirmed', confirmedAt: nowIso(), confirmedBy: user.id };
      state.company[key] = confirmed;
      file.companyDraft![key] = confirmed;
    }
    file.companyOwnerStatus = 'matching_current_owner';
    state.updatedAt = nowIso();
    state.audit.unshift({ id: nextId('IA-'), action: 'company_subject_confirmed', actorId: user.id, detail: `用户明确选择公司主体文件 ${file.id}；不是平台审核批准。`, createdAt: nowIso() });
    state.checklist = checklistFor(state);
    return state;
  });
}

export function getBrandIntakeDocument(user: SessionUser, fileId: string, brandId?: number | null) {
  const state = readStore().states.find(state => state.memberId === user.id && (state.brandId || null) === (Number(brandId || 0) || null));
  const file = state?.files.find(file => file.id === fileId && file.memberId === user.id);
  if (!file || path.basename(file.token) !== file.token) return null;
  const target = path.join(intakeDocumentDirectory(), file.token);
  return existsSync(target) ? { file, bytes: readFileSync(target) } : null;
}

export function storeIntakeCompanyAttachment(user: SessionUser, fileId: string, attachment: NonNullable<IntakeFileRecord['applicationAttachment']> | null, brandId?: number | null) {
  return withWrite(store => {
    const state = findOrCreateState(store, user, brandId);
    const file = state.files.find(file => file.id === fileId && file.memberId === user.id);
    if (!file || !file.companyContentMatched || companyOwnerStatus(state, file.companyDraft || {}) !== 'matching_current_owner') throw new Error('此文件的公司主体尚未确认');
    if (attachment) file.applicationAttachment = attachment;
    else file.warnings.push('公司主体已确认，但证件转换未完成；请单独上传合法公司页，不能使用收件token代替证件。');
    state.updatedAt = nowIso();
    return state;
  });
}

const companyDetailFields = new Set(['legalRepresentative', 'companyType', 'registeredCapital', 'establishmentDate', 'companyAddress', 'businessScope']);
const manualDocumentKinds = new Set<IntakeDocumentKind>(['business_license', 'company_registration', 'conformity_certificate', 'emc_test_report', 'wavelength_test_report', 'agency_classification_letter', 'patent_document', 'insurance_document', 'authorization_document', 'lab_accreditation', 'document_cover', 'mixed_document', 'sensitive_document', 'visual_asset', 'trademark_certificate', 'company_profile', 'brand_manual', 'product_catalog', 'product_image', 'ingredient_spec', 'price_list', 'inspection_report', 'license_permit', 'spreadsheet', 'unknown']);

export function confirmIntakeDocumentCandidate(user: SessionUser, input: { brandId?: number | null; fileId: string; action: 'confirm_document_field' | 'set_document_kind' | 'confirm_company_field' | 'confirm_document_section_field'; field?: string; value?: string; kind?: IntakeDocumentKind; sectionIndex?: number }) {
  return withWrite(store => {
    const state = findOrCreateState(store, user, input.brandId);
    const file = state.files.find(file => file.id === input.fileId && file.memberId === user.id);
    if (!file) throw new Error('找不到本账户资料');
    if (input.action === 'set_document_kind') {
      if (!input.kind || !manualDocumentKinds.has(input.kind)) throw new Error('请选择有效的资料类型');
      file.manualKind = input.kind;
      file.status = 'needs_confirmation';
      file.warnings.push('人工类型标记不改变识别证据，也不会授予公司主体、商品发布或平台审核权限。');
      if (input.kind === 'sensitive_document') {
        file.extractedTextPreview = '';
        file.documentDraft = {};
        file.companyDraft = {};
        file.companyContentMatched = false;
        if (file.identification) {
          file.identification.signals = [];
          file.identification.fields = {};
          file.identification.sections = [];
        }
      }
    } else if (input.action === 'confirm_document_section_field') {
      const index = Number(input.sectionIndex);
      const section = Number.isSafeInteger(index) && index >= 0 ? file.identification?.sections[index] : undefined;
      const key = String(input.field || '');
      if (!section || section.kind === 'sensitive_document' || file.manualKind === 'sensitive_document'
        || section.pages.some(page => file.identification?.sensitivePages.includes(page))
        || !Object.prototype.hasOwnProperty.call(section.fields, key)) throw new Error('此分段或字段不存在、没有来源或包含敏感资料');
      const candidate = section.fields[key];
      const value = text(input.value);
      if (!value || value.length > 2000 || !candidate.sources.length || candidate.sources.some(source => !section.pages.includes(source.page))) throw new Error('请保留本文件、本分段的字段来源');
      if (candidate.userConfirmedValue && candidate.userConfirmedValue !== value) throw new Error('已确认的人工值不能覆盖');
      candidate.value = value;
      candidate.userConfirmedValue = value;
      candidate.userConfirmation = { actorId: user.id, at: nowIso() };
      candidate.needsReview = true;
      file.status = 'needs_confirmation';
    } else {
      const key = String(input.field || '');
      const bucket: Record<string, IntakeFieldDraft> | undefined = input.action === 'confirm_company_field' ? file.companyDraft : file.documentDraft;
      if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, key)) throw new Error('此候选字段没有原件来源，不能假装已识别；请在申请表人工补充');
      const candidate = bucket[key];
      const value = text(input.value);
      if (!value || value.length > 2000 || !candidate.sources.length) throw new Error('请填写候选值并保留原件来源');
      if (candidate.userConfirmedValue && candidate.userConfirmedValue !== value) throw new Error('已确认的人工值不能由另一份资料覆盖');
      if (input.action === 'confirm_company_field') {
        if (!companyDetailFields.has(key) || !file.companyContentMatched || companyOwnerStatus(state, file.companyDraft || {}) !== 'matching_current_owner') throw new Error('请先确认此文件属于当前公司主体');
        if (state.company[key]?.userConfirmedValue && state.company[key].userConfirmedValue !== value) throw new Error('已确认的公司人工值不能覆盖');
      }
      const source = provenance(file, '用户明确修订候选字段；不是自动识别或平台审批', value, 1, 'user', 'confirmed');
      const confirmed = { ...candidate, value, userConfirmedValue: value, sources: [...candidate.sources, source], validationStatus: 'confirmed' as const, confirmedAt: nowIso(), confirmedBy: user.id };
      bucket[key] = confirmed;
      if (input.action === 'confirm_company_field') state.company[key] = confirmed;
      file.status = 'needs_confirmation';
    }
    state.updatedAt = nowIso();
    state.audit.unshift({ id: nextId('IA-'), action: input.action, actorId: user.id, detail: `用户处理候选文件 ${file.id}；原档、识别类型及权限边界不变。`, createdAt: nowIso() });
    state.checklist = checklistFor(state);
    return state;
  });
}

export function confirmBrandIntakeField(user: SessionUser, input: { brandId?: number | null; entity: 'company' | 'brand' | 'license' | 'product'; productDraftId?: string; field: string; value?: string }) {
  return withWrite((store) => {
    const state = findOrCreateState(store, user, input.brandId);
    const confirmedAt = nowIso();
    if (input.entity === 'product') {
      const product = state.productDrafts.find((item) => item.id === input.productDraftId);
      if (!product) throw new Error('找不到商品草稿');
      const target = input.field === 'title' ? product.title : product.fields[input.field];
      if (!target) throw new Error('找不到草稿字段');
      target.userConfirmedValue = text(input.value || target.value);
      target.value = target.userConfirmedValue;
      target.validationStatus = 'confirmed';
      target.confirmedAt = confirmedAt;
      target.confirmedBy = user.id;
      if (input.field === 'title') product.status = 'confirmed';
      product.updatedAt = confirmedAt;
    } else {
      const bucket = input.entity === 'company' ? state.company : input.entity === 'brand' ? state.brand : state.licenses;
      const target = bucket[input.field];
      if (!target) throw new Error('找不到草稿字段');
      target.userConfirmedValue = text(input.value || target.value);
      target.value = target.userConfirmedValue;
      target.validationStatus = 'confirmed';
      target.confirmedAt = confirmedAt;
      target.confirmedBy = user.id;
    }
    state.audit.unshift({ id: nextId('IA-'), action: 'field_confirmed', actorId: user.id, detail: `${input.entity}.${input.field} 已由用户确认。`, createdAt: confirmedAt });
    state.checklist = checklistFor(state);
    state.updatedAt = confirmedAt;
    return state;
  });
}

export function publicBrandIntakeState(state: BrandIntakeState) {
  const summary = {
    companies: Object.keys(state.company).length ? 1 : 0,
    products: state.productDrafts.length,
    certificates: state.files.filter((file) => !['unknown', 'visual_asset', 'product_catalog', 'price_list'].includes(file.kind)).length,
    needsConfirmation: state.checklist.filter((item) => ['needs_confirmation', 'conflict', 'incomplete', 'missing'].includes(item.status)).length,
  };
  return {
    ...state,
    humanSummary: `申请主体 ${summary.companies} 个、商品草稿 ${summary.products} 个、资料候选 ${summary.certificates} 份；原件逐份归档，类型、角色、来源及未识别页面仍需核对。`,
  };
}
