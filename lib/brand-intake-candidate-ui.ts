import type { BrandIntakeState, IntakeFieldDraft, IntakeFileRecord, IntakeProvenance } from './cn-brand-intake-brain';
import { brandDocumentTokenOwner } from './brand-application-documents';

export type CandidateApplicationAttachment = { token: string; name: string; kind: 'license'; size: number; verificationStatus: 'manual_review'; sourceFileId: string; sourceSha256: string; sourcePage: number };
export type CandidateIntakeFile = IntakeFileRecord & { applicationAttachment?: CandidateApplicationAttachment };
export type CandidateIntakeState = Pick<BrandIntakeState, 'memberId' | 'brandId' | 'company' | 'brand' | 'productDrafts' | 'checklist' | 'categorySuggestions'> & { files: CandidateIntakeFile[] };
export type CandidateEntity = 'company' | 'brand' | 'product';
export type CandidateField = IntakeFieldDraft & { role?: string };
export type ApplicationCandidateValues = Record<string, string>;

export const COMPANY_FIELDS = ['companyName', 'registrationNo', 'legalRepresentative', 'companyType', 'registeredCapital', 'establishmentDate', 'companyAddress', 'businessScope'] as const;
export const BRAND_FIELDS = ['brandName', 'contactName', 'phone', 'introduction'] as const;
export const FIELD_LABELS: Record<string, string> = {
  companyName: '公司名称', registrationNo: '统一社会信用代码', legalRepresentative: '法定代表人', companyType: '公司类型', registeredCapital: '注册资本', establishmentDate: '成立日期', companyAddress: '住所', businessScope: '经营范围',
  brandName: '品牌名称', contactName: '联系人', phone: '联系电话', introduction: '品牌简介', title: '商品名称', sku: '货号', spec: '规格', price: '价格', stock: '库存', ingredients: '成分', claimsRaw: '商品描述', permitNo: '许可编号',
  applicantName: '申请人', issuerName: '签发机构', manufacturerName: '制造商', subjectName: '文件主体', productName: '产品名称', model: '型号', modelName: '型号', reportNo: '报告编号', certificateNo: '证书编号', standards: '检测标准', issueDate: '签发日期',
  patentNo: '专利号', patentName: '专利名称', patentHolderName: '专利权人', inventorName: '发明人', applicationDate: '申请日期', announcementNo: '公告号', announcementDate: '公告日期',
  policyNo: '保单号', insuredName: '被保险人', policyHolderName: '投保人', coverageTerritory: '承保地域', currency: '币种', effectiveFrom: '起始日期', effectiveTo: '截止日期', coverageAmount: '保额',
  authorizerName: '授权方', authorizedPartyName: '被授权方', authorizationScope: '授权范围', documentNo: '文件编号', recipientName: '受文者', classificationStatement: '函件内容', laboratoryName: '实验室名称', accreditationNo: '认可编号', testResult: '检测结果', wavelength: '波长',
  testDate: '检测日期', letterNo: '发文字号', addressee: '受文者', jurisdiction: '适用地区', classificationText: '函件内容', patentTitle: '专利名称', referenceNo: '授权编号', accreditedLabName: '实验室名称', scope: '认可范围',
};
export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  business_license: '营业执照', company_registration: '公司登记文件', conformity_certificate: '符合性证书', emc_test_report: 'EMC 检测报告', wavelength_test_report: '波长检测报告', agency_classification_letter: '机构函件', patent_document: '专利文件', insurance_document: '保险文件', authorization_document: '授权文件', lab_accreditation: '实验室认可资料', document_cover: '报告封面', mixed_document: '混合资料', sensitive_document: '敏感资料', visual_asset: '图片素材', trademark_certificate: '商标文件', company_profile: '公司介绍', brand_manual: '品牌资料', product_catalog: '商品型录', product_image: '商品图片', ingredient_spec: '成分与规格', price_list: '价格表', inspection_report: '检测报告', license_permit: '许可文件', spreadsheet: '表格', unknown: '未识别',
};
export const ROLE_LABELS: Record<string, string> = { subject: '文件主体', issuer: '签发机构', applicant: '申请人', manufacturer: '制造商', insured: '被保险人', policy_holder: '投保人', authorizer: '授权方', authorized_party: '被授权方', patent_holder: '专利权人', inventor: '发明人', document: '文件资料' };
export const PART_LABELS: Record<string, string> = { final: '正式件（待核对）', draft: '草稿', cover: '封面', body: '正文（待核对）', unknown: '版本未确认' };

export function sameCandidateValue(left: string, right: string) {
  return left.trim() === right.trim();
}

export function isSensitiveCandidateText(value: string) {
  return /密钥|密鑰|查询口令|查詢口令|查询码|查詢碼|access[ _-]*key|secret[ _-]*key|查询凭证|查詢憑證|UKEY|(?:^|\n)\s*(?:密码|密碼|password)\s*[:：]|身份[证證]|identity\s*card/i.test(value)
    || /銀行|银行|bank|银行卡|銀行卡/i.test(value) && /帳號|账号|帐户|帳戶|account|card\s*number|卡号|卡號/i.test(value);
}

export function isSensitiveIntakeFile(file: IntakeFileRecord) {
  return file.kind === 'sensitive_document' || file.manualKind === 'sensitive_document' || /(?:身份证|身份證|访问密钥|存取金鑰|access.?key)/i.test(file.originalName);
}

export function candidateActionError(value: unknown) {
  if (typeof value !== 'string' || /(?:Command failed|ArrayBuffer|SyntaxError|TypeError|pdftoppm|tesseract|\/data\/|\/tmp\/|\/Users\/)/i.test(value) || isSensitiveCandidateText(value)) return '处理失败，请重试或联系平台。';
  return value.slice(0, 240);
}

export function safeCandidateSources(field: CandidateField, files: IntakeFileRecord[]) {
  return (field.sources || []).filter(source => {
    const file = files.find(file => file.id === source.sourceFileId);
    return file && !isSensitiveIntakeFile(file)
      && !(source.page && file.identification?.sensitivePages.includes(source.page))
      && !isSensitiveCandidateText(source.rawText) && !isSensitiveCandidateText(source.extractedValue);
  });
}

export function visibleCandidateFields(fields: Record<string, CandidateField> | undefined, files: IntakeFileRecord[]) {
  return Object.entries(fields || {}).filter(([, field]) => Boolean(field.value)
    && !isSensitiveCandidateText(field.value) && safeCandidateSources(field, files).length > 0);
}

export function sectionCandidateFields(file: IntakeFileRecord, sectionIndex: number, files: IntakeFileRecord[]) {
  const section = file.identification?.sections[sectionIndex];
  if (!Number.isSafeInteger(sectionIndex) || sectionIndex < 0 || !section || section.kind === 'sensitive_document' || isSensitiveIntakeFile(file)
    || section.pages.some(page => file.identification?.sensitivePages.includes(page))) return [];
  const fields: Record<string, CandidateField> = Object.fromEntries(Object.entries(section.fields).filter(([, candidate]) => candidate.sources.length
    && candidate.sources.every(source => section.pages.includes(source.page))).map(([key, candidate]) => [key, {
    value: candidate.value, role: candidate.role, confidence: Math.min(...candidate.sources.map(source => source.confidence)),
    validationStatus: candidate.userConfirmedValue === candidate.value && candidate.userConfirmation?.actorId === file.memberId
      && Boolean(candidate.userConfirmation.at) ? 'confirmed' : candidate.conflict ? 'conflict' : 'needs_confirmation',
    userConfirmedValue: candidate.userConfirmedValue, confirmedBy: candidate.userConfirmation?.actorId, confirmedAt: candidate.userConfirmation?.at,
    sources: candidate.sources.map(source => ({ ...source, sourceFileId: file.id, sourceFileName: file.originalName, extractedValue: candidate.value, validationStatus: 'needs_confirmation' })),
  }]));
  return visibleCandidateFields(fields, files);
}

export function confirmedSectionResponseField(state: CandidateIntakeState, originalFile: IntakeFileRecord, sectionIndex: number, key: string, expected: string) {
  const file = state.files.find(file => file.id === originalFile.id);
  const original = originalFile.identification?.sections[sectionIndex];
  const section = file?.identification?.sections[sectionIndex];
  const field = section?.fields[key];
  const sourceField = original?.fields[key];
  if (!file || file.memberId !== state.memberId || file.memberId !== originalFile.memberId || file.brandId !== originalFile.brandId
    || file.kind !== 'mixed_document' || file.kind !== originalFile.kind || file.manualKind !== originalFile.manualKind
    || file.sha256 !== originalFile.sha256 || file.token !== originalFile.token || file.status !== 'needs_confirmation'
    || !Number.isSafeInteger(sectionIndex) || sectionIndex < 0 || !original || !section || !sourceField || !field
    || section.kind !== original.kind || section.pages.length !== original.pages.length || section.pages.some((page, index) => page !== original.pages[index])
    || !sectionCandidateFields(file, sectionIndex, state.files).some(([fieldKey]) => fieldKey === key)
    || !sameCandidateValue(field.value, expected) || field.userConfirmedValue !== expected.trim()
    || field.userConfirmation?.actorId !== state.memberId || !field.userConfirmation.at || !Number.isFinite(Date.parse(field.userConfirmation.at))
    || field.needsReview !== true || field.role !== sourceField.role || field.sources.length !== sourceField.sources.length
    || field.sources.some((source, index) => {
      const before = sourceField.sources[index];
      return source.page !== before.page || source.rawText !== before.rawText || source.confidence !== before.confidence || source.extractor !== before.extractor;
    })) {
    throw new Error('片段字段未保存或来源不一致，请重新读取资料。');
  }
  return field.value;
}

export function canChooseCompany(file: IntakeFileRecord, state: CandidateIntakeState) {
  const fields = file.companyDraft;
  if (hasConfirmedCompany(state)) {
    const normalize = (value: string) => value.replace(/\s/g, '').toUpperCase();
    if (['companyName', 'registrationNo'].some(key => normalize(state.company[key]?.userConfirmedValue || '') !== normalize(fields?.[key]?.value || ''))) return false;
  }
  return file.memberId === state.memberId && !isSensitiveIntakeFile(file)
    && file.companyContentMatched === true && file.companyOwnerStatus !== 'conflict'
    && ['companyName', 'registrationNo'].every(key => {
      const field = fields?.[key];
      return field && field.validationStatus !== 'conflict' && field.validationStatus !== 'rejected'
        && !isSensitiveCandidateText(field.value) && safeCandidateSources(field, state.files).length > 0;
    });
}

export function hasConfirmedCompany(state: CandidateIntakeState) {
  return ['companyName', 'registrationNo'].every(key => {
    const field = state.company[key];
    return field?.validationStatus === 'confirmed' && Boolean(field.userConfirmedValue) && Boolean(field.confirmedBy);
  });
}

export function companyFileMatchesOwner(file: IntakeFileRecord, state: CandidateIntakeState) {
  const normalize = (value: string) => value.replace(/\s/g, '').toUpperCase();
  return hasConfirmedCompany(state) && canChooseCompany(file, state)
    && ['companyName', 'registrationNo'].every(key => normalize(state.company[key]?.userConfirmedValue || '') === normalize(file.companyDraft?.[key]?.value || ''));
}

export function assertConfirmedCompanyResponse(state: CandidateIntakeState, fileId: string, name: string, code: string) {
  const file = state.files.find(file => file.id === fileId);
  if (!file || file.companyOwnerStatus !== 'matching_current_owner' || !hasConfirmedCompany(state)
    || !sameCandidateValue(state.company.companyName.userConfirmedValue || '', name)
    || !sameCandidateValue(state.company.registrationNo.userConfirmedValue || '', code.toUpperCase())) {
    throw new Error('公司主体未确认，请重新核对文件。');
  }
  return { companyName: state.company.companyName.value, registrationNo: state.company.registrationNo.value };
}

export function confirmedCompanyAttachment(state: CandidateIntakeState, fileId: string) {
  const file = state.files.find(file => file.id === fileId), attachment = file?.applicationAttachment;
  if (!attachment) return null;
  if (!file || !companyFileMatchesOwner(file, state) || attachment.kind !== 'license'
    || attachment.sourceFileId !== file.id || attachment.sourceSha256 !== file.sha256
    || attachment.verificationStatus !== 'manual_review' || brandDocumentTokenOwner(attachment.token) !== state.memberId
    || attachment.token === file.token || !attachment.name || !Number.isFinite(attachment.size) || attachment.size <= 0
    || !Number.isInteger(attachment.sourcePage) || attachment.sourcePage <= 0
    || file.identification?.sensitivePages.includes(attachment.sourcePage)) throw new Error('主体文件附件未核对，请单独上传证件。');
  return attachment;
}

export function existingConfirmedAttachment(state: CandidateIntakeState) {
  const selectedSource = [...(state.company.companyName?.sources || [])].reverse().find(source => source.extractor === 'user');
  return selectedSource ? confirmedCompanyAttachment(state, selectedSource.sourceFileId) : null;
}

export function confirmedResponseField(state: CandidateIntakeState, entity: CandidateEntity, field: string, expected: string, productDraftId?: string) {
  const product = entity === 'product' ? state.productDrafts.find(product => product.id === productDraftId) : undefined;
  const result = entity === 'product' ? field === 'title' ? product?.title : product?.fields[field] : state[entity][field];
  if (!result || result.validationStatus !== 'confirmed' || !sameCandidateValue(result.value, expected)) throw new Error('字段未保存，请重试。');
  return result.value;
}

export function confirmedApplicationValues(state: CandidateIntakeState) {
  const company = hasConfirmedCompany(state) ? state.company : {};
  const allowed = new Set<string>([...COMPANY_FIELDS, ...BRAND_FIELDS]);
  return Object.fromEntries(visibleCandidateFields({ ...company, ...state.brand }, state.files)
    .filter(([key, field]) => allowed.has(key) && field.validationStatus === 'confirmed'
      && field.userConfirmedValue && sameCandidateValue(field.value, field.userConfirmedValue))
    .map(([key, field]) => [key, field.value]));
}

export function candidateNeedsReplacement(current: string | undefined, value: string) {
  return Boolean(current?.trim()) && !sameCandidateValue(current || '', value);
}

export function sourceCaption(source: IntakeProvenance) {
  const page = source.page ? `第 ${source.page} 页` : source.extractor === 'user' ? '人工确认' : '页码未提供';
  const provider = source.extractor === 'ocr' ? '扫描识别' : source.extractor === 'deterministic' ? '原文' : '';
  return `${source.sourceFileName} · ${page}${provider ? ` · ${provider}` : ''}`;
}

export function displayConfidence(value: number) {
  return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%` : '待核对';
}
