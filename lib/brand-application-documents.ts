export const BRAND_APPLICATION_DOCUMENT_KINDS = [
  'license',
  'brand_rights',
  'category_qualification',
  'brand_profile',
  'other',
] as const;

export const MAX_BRAND_APPLICATION_DOCUMENTS_PER_KIND = 10;

export type BrandApplicationDocumentKind = (typeof BRAND_APPLICATION_DOCUMENT_KINDS)[number];

export type BrandApplicationDocument = {
  token: string;
  name: string;
  kind: BrandApplicationDocumentKind;
  size?: number;
};

export const BRAND_APPLICATION_DOCUMENT_LABELS: Record<BrandApplicationDocumentKind, string> = {
  license: '主体登记文件',
  brand_rights: '商标／品牌授权',
  category_qualification: '类目经营资质',
  brand_profile: '品牌介绍与视觉资料',
  other: '其他补充材料',
};

function text(value: unknown, limit = 500) {
  return String(value ?? '').trim().slice(0, limit);
}

function documentKind(value: unknown): BrandApplicationDocumentKind {
  const kind = text(value, 40) as BrandApplicationDocumentKind;
  return BRAND_APPLICATION_DOCUMENT_KINDS.includes(kind) ? kind : 'other';
}

function normalizeBrandApplicationDocumentRows(value: unknown, maxRows: number) {
  if (!Array.isArray(value)) return [] as BrandApplicationDocument[];
  const seen = new Set<string>();
  const rows: BrandApplicationDocument[] = [];
  for (const item of value) {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const token = text(row.token, 300);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    const size = Number(row.size || 0);
    rows.push({
      token,
      name: text(row.name, 180) || token,
      kind: documentKind(row.kind),
      ...(Number.isFinite(size) && size > 0 ? { size } : {}),
    });
    if (rows.length >= maxRows) break;
  }
  return rows;
}

export function normalizeBrandApplicationDocuments(value: unknown) {
  return normalizeBrandApplicationDocumentRows(value, 50);
}

export function mergeLegacyBrandApplicationDocuments(
  value: unknown,
  legacy: Array<Partial<BrandApplicationDocument>>,
) {
  // Submission validation must see every row, including a legacy tail.
  return normalizeBrandApplicationDocumentRows([
    ...normalizeBrandApplicationDocumentRows(value, Infinity),
    ...legacy.filter((item) => item.token),
  ], Infinity);
}

export function enforceBrandApplicationDocumentLimits(value: unknown) {
  // Validation must inspect the tail that display normalization truncates.
  const rows = normalizeBrandApplicationDocumentRows(value, Infinity);
  const counts = new Map<BrandApplicationDocumentKind, number>();
  for (const row of rows) {
    const count = (counts.get(row.kind) || 0) + 1;
    if (count > MAX_BRAND_APPLICATION_DOCUMENTS_PER_KIND) {
      throw new Error(`${BRAND_APPLICATION_DOCUMENT_LABELS[row.kind]}每类最多上传 ${MAX_BRAND_APPLICATION_DOCUMENTS_PER_KIND} 份`);
    }
    counts.set(row.kind, count);
  }
  return rows;
}

export function brandDocumentTokenOwner(token: string) {
  const match = /^[a-z][a-z0-9_]{0,29}-([1-9]\d*)-\d{13}-[a-f0-9]{10}\.(?:pdf|jpg|png|webp)$/i.exec(token);
  const ownerId = match?.[0] === token ? Number(match[1]) : NaN;
  return Number.isSafeInteger(ownerId) && ownerId > 0 ? ownerId : null;
}

export function enforceBrandApplicationDocumentOwnership(
  value: unknown,
  memberId: number,
  resolveOwner: (token: string) => number | null = brandDocumentTokenOwner,
) {
  const rows = normalizeBrandApplicationDocumentRows(value, Infinity);
  if (!Number.isSafeInteger(memberId) || memberId <= 0 || rows.some((row) => resolveOwner(row.token) !== memberId)) {
    throw new Error('申请文件不属于当前会员，请重新上传');
  }
  return rows;
}
