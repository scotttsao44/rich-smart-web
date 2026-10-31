export const BRAND_DOCUMENT_REVIEW_OFFICIAL_SOURCES = [
  { id: 'company', label: '企业登记查询', url: 'https://www.gsxt.gov.cn/index.html' },
  { id: 'medical', label: '医疗器械查询', url: 'https://www.nmpa.gov.cn/ylqx/' },
  { id: 'patent', label: '专利查询', url: 'https://ggfw.cnipa.gov.cn/' },
] as const;

export const BRAND_DOCUMENT_REVIEW_SOURCE_HOSTS = [
  'www.gsxt.gov.cn', 'gsxt.gov.cn', 'www.nmpa.gov.cn',
  'datasearch.nmpa.gov.cn', 'udi.nmpa.gov.cn',
  'ggfw.cnipa.gov.cn', 'cpquery.cponline.cnipa.gov.cn',
  'pss-system.cponline.cnipa.gov.cn', 'www.cnipa.gov.cn',
] as const;

export type BrandDocumentReviewOutcome = 'manual_match' | 'manual_mismatch' | 'unverified';
export type ReviewApplication = {
  id: number;
  companyName: string;
  registrationNo?: string;
  submittedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  businessLicenseDocument?: string;
  profileDocument?: string;
  trademarkDocument?: string;
  brandDocuments?: readonly { token: string; kind?: string }[];
};
export type BrandDocumentReviewInput = {
  applicationId: number;
  snapshotId: string;
  outcome: BrandDocumentReviewOutcome;
  sourceUrl: string;
  evidenceNote: string;
  checkedCompanyName: string;
  checkedRegistrationNo: string;
};
export type StoredBrandDocumentReview = BrandDocumentReviewInput & {
  id: string;
  checkedAt: string;
  checkedBy: number;
  method: 'platform_manual';
};
export type BrandDocumentReviewRecord = StoredBrandDocumentReview & { stale: boolean };
export class BrandDocumentReviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function reviewApplicationId(value: unknown) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value))) throw new BrandDocumentReviewError(400, '申请编号不正确');
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new BrandDocumentReviewError(400, '申请编号不正确');
  return id;
}

function stringValue(value: unknown, maximum: number) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value)) throw new BrandDocumentReviewError(400, '查证字段格式不正确');
  return value.trim();
}

export function validateReviewSourceUrl(value: string) {
  if (!value) return '';
  if (value.length > 2048 || /\s|[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new BrandDocumentReviewError(400, '仅接受官方白名单 HTTPS 来源网址');
  let url: URL;
  try { url = new URL(value); } catch { throw new BrandDocumentReviewError(400, '仅接受官方白名单 HTTPS 来源网址'); }
  if (url.protocol !== 'https:' || url.username || url.password || /^https:\/\/[^/?#]*@/i.test(value) || url.port || !(BRAND_DOCUMENT_REVIEW_SOURCE_HOSTS as readonly string[]).includes(url.hostname)) throw new BrandDocumentReviewError(400, '仅接受官方白名单 HTTPS 来源网址');
  return url.href;
}

const companyKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const registrationKey = (value: string) => value.normalize('NFKC').trim().toUpperCase();

export function validateBrandDocumentReviewInput(value: unknown, application: ReviewApplication): BrandDocumentReviewInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrandDocumentReviewError(400, '查证内容必须为对象');
  const row = value as Record<string, unknown>;
  const keys = ['applicationId', 'snapshotId', 'outcome', 'sourceUrl', 'evidenceNote', 'checkedCompanyName', 'checkedRegistrationNo'];
  if (Object.keys(row).some(key => !keys.includes(key))) throw new BrandDocumentReviewError(400, '查证内容含不允许的字段');
  const applicationId = reviewApplicationId(row.applicationId);
  if (applicationId !== application.id) throw new BrandDocumentReviewError(400, '申请编号不一致');
  const snapshotId = stringValue(row.snapshotId, 64);
  if (!/^[a-f0-9]{64}$/.test(snapshotId)) throw new BrandDocumentReviewError(400, '快照编号不正确');
  const outcome = row.outcome as BrandDocumentReviewOutcome;
  if (!['manual_match', 'manual_mismatch', 'unverified'].includes(outcome)) throw new BrandDocumentReviewError(400, '仅允许人工查证结果，不接受自动核实标记');
  const evidenceNote = stringValue(row.evidenceNote, 4000);
  const concrete = evidenceNote.match(new RegExp('[\\p{L}\\p{N}]', 'gu')) || [];
  if (concrete.length < 12 || new Set(concrete).size < 4) throw new BrandDocumentReviewError(400, '请提供具体查证过程与差异说明（至少 12 个文字或数字）');
  const sourceUrl = validateReviewSourceUrl(stringValue(row.sourceUrl ?? '', 2048));
  const checkedCompanyName = stringValue(row.checkedCompanyName ?? '', 300);
  const checkedRegistrationNo = stringValue(row.checkedRegistrationNo ?? '', 100);
  if (outcome === 'manual_match' && (!sourceUrl || !checkedCompanyName || !checkedRegistrationNo || !application.companyName?.trim() || !application.registrationNo?.trim()
    || companyKey(checkedCompanyName) !== companyKey(application.companyName)
    || registrationKey(checkedRegistrationNo) !== registrationKey(application.registrationNo))) {
    throw new BrandDocumentReviewError(400, '人工一致须有官方来源、具体说明及与申请相符的公司和统编');
  }
  return { applicationId, snapshotId, outcome, sourceUrl, evidenceNote, checkedCompanyName, checkedRegistrationNo };
}

export function serializeReviewApplicationSnapshot(application: ReviewApplication) {
  const documents = application.brandDocuments || [];
  if (!Array.isArray(documents) || documents.some(row => !row || typeof row.token !== 'string' || (row.kind !== undefined && typeof row.kind !== 'string'))) throw new BrandDocumentReviewError(503, '申请文件索引不可用');
  const tokens = documents.map(row => [row.kind || '', row.token]);
  for (const key of ['businessLicenseDocument', 'profileDocument', 'trademarkDocument'] as const) tokens.push([key, application[key] || '']);
  tokens.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
  return JSON.stringify({ version: 1, applicationId: application.id, companyName: application.companyName, registrationNo: application.registrationNo || '', submittedAt: application.submittedAt || '', updatedAt: application.updatedAt || '', createdAt: application.createdAt || '', tokens });
}
