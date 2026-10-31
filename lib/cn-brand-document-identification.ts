import { candidateFromMatch, compactDocumentText, documentDate, documentMarkerText, extractLabelledDocumentField } from './cn-document-field-layout';
import { supplementalDocumentFields } from './cn-document-supplemental-fields';

export type IntakeDocumentKind = 'business_license' | 'company_registration' | 'conformity_certificate' | 'emc_test_report' | 'wavelength_test_report' | 'agency_classification_letter' | 'patent_document' | 'insurance_document' | 'authorization_document' | 'lab_accreditation' | 'document_cover' | 'mixed_document' | 'sensitive_document' | 'visual_asset' | 'trademark_certificate' | 'company_profile' | 'brand_manual' | 'product_catalog' | 'product_image' | 'ingredient_spec' | 'price_list' | 'inspection_report' | 'license_permit' | 'spreadsheet' | 'unknown';
export type DocumentSubjectRole = 'subject' | 'issuer' | 'applicant' | 'manufacturer' | 'insured' | 'policy_holder' | 'authorizer' | 'authorized_party' | 'patent_holder' | 'inventor' | 'document';
export type DocumentTextPage = {
  page: number;
  text: string;
  extractor: 'deterministic' | 'ocr';
  sensitive?: boolean;
  lines?: Array<{ text: string; confidence?: number; x?: number; y?: number; width?: number; height?: number }>;
};
export type DocumentFieldCandidate = { value: string; role: DocumentSubjectRole; sources: Array<{ page: number; rawText: string; confidence: number; extractor: 'deterministic' | 'ocr' }>; needsReview: true; conflict?: boolean; userConfirmedValue?: string; userConfirmation?: { actorId: number; at: string } };
export type DocumentIdentification = {
  kind: IntakeDocumentKind;
  confidence: number;
  part: 'cover' | 'draft' | 'body' | 'unknown';
  relatedKind?: IntakeDocumentKind;
  filenameHint?: IntakeDocumentKind;
  filenamePartHint?: 'cover' | 'draft';
  signals: Array<{ page: number; rawText: string }>;
  fields: Record<string, DocumentFieldCandidate>;
  pageKinds: Array<{ page: number; kind: IntakeDocumentKind }>;
  sections: Array<{ kind: IntakeDocumentKind; pages: number[]; fields: Record<string, DocumentFieldCandidate>; subjectRef?: { scheme: 'CNAS' | 'CMA'; certificateNo?: string } }>;
  sensitivePages: number[];
  needsReview: true;
  warnings: string[];
};

const hanSpacing = new RegExp('(\\p{Script=Han})[ \\t\\u00a0\\u3000]+(?=\\p{Script=Han})', 'gu');
const nonWord = new RegExp('[^\\p{L}\\p{N}]', 'gu');
const hanCharacter = new RegExp('\\p{Script=Han}', 'u');
function normalize(text: string) { return text.replace(hanSpacing, '$1').replace(/\r/g, '\n'); }
function isCmaCertificateText(text: string) {
  const marker = documentMarkerText(text);
  const compact = marker.replace(/\s+/g, '');
  // The title is required. OCR line breaks may split the corroborating institution text.
  const title = marker.split('\n').some(line => /^(?:检验检测机构)?资[质質]认定证书$/.test(line.replace(/\s+/g, '')));
  return title
    && (/检验检测机构|计量认证|发证机关|证书编号/.test(compact)
      || /(?:^|\n)\s*(?:名称|名稱)\s*[:：]/m.test(marker));
}
function meaningful(text: string) { return normalize(text).replace(nonWord, '').length >= 24; }
export function hasUsableDocumentText(text: string) { return meaningful(text); }
export function isSensitiveDocumentPage(text: string) {
  return /密钥|密鑰|查询口令|查詢口令|查询码|查詢碼|access[ _-]*key|secret[ _-]*key|查询凭证|查詢憑證|UKEY|(?:^|\n)\s*(?:密码|密碼|password)\s*[:：]/im.test(normalize(text))
    || /銀行|银行|银行卡|銀行卡|bank/i.test(text) && (/帳號|账号|帳戶|账户|卡號|卡号|account|card\s*number/i.test(text) || /(?:\d[ \t-]*){12,19}/.test(text));
}

function contentKind(text: string): IntakeDocumentKind {
  const zh = documentMarkerText(text);
  if (isSensitiveDocumentPage(zh)) return 'sensitive_document';
  const emc = /\bEMC\b|electromagnetic|EN\s*55014|2014\s*\/\s*30\s*\/\s*EU/i.test(zh);
  const testReport = /test(?:ing)?\s*report|检测报告|檢測報告|检验报告|檢驗報告|試驗報告|试验报告/i.test(zh);
  if (/保險(?:單|契約)|保险(?:单|合同)|public\s+liability|insurance\s+policy|被保險人|被保险人/i.test(zh)) return 'insurance_document';
  if (/专利证书|專利證書|实用新型专利|實用新型專利|發明專利|发明专利|patent\s+(?:certificate|no|number)/i.test(zh) && /专利权人|專利權人|專利號|专利号|专利名称|專利名稱|知识产权|智慧財產|patent/i.test(zh)) return 'patent_document';
  if (/衛生福利部|卫生福利部|食品藥物管理署|食品药物管理署|衛部|衛授食/i.test(zh) && /医疗器材|医疗器械|醫療器材|醫療器械/i.test(zh)) return 'agency_classification_letter';
  if (/認可證書|认可证书|認可證明|认可证明|accreditation\s+certificate|laboratory\s+accreditation/i.test(zh) && /\bCNAS\b|合格評定|合格评定|accreditation/i.test(zh)) return 'lab_accreditation';
  if (isCmaCertificateText(text)) return 'lab_accreditation';
  if (/授权书|授權書|授权证书|授權證書|letter\s+of\s+authori[sz]ation/i.test(zh)) return 'authorization_document';
  if (/certificate\s+of\s+(?:conformity|compliance)|attestation\s+of\s+compliance|verification\s+of\s+conformity|compliance\s+certificate/i.test(zh) && emc) return 'conformity_certificate';
  if (testReport && emc) return 'emc_test_report';
  if (testReport && /波长|光谱|谱图|峰值波|wavelength|spectrum|spectral|\d+(?:\.\d+)?\s*nm\b/i.test(zh)) return 'wavelength_test_report';
  if (testReport) return 'inspection_report';
  if (/营业执照|營業執照/.test(zh) && /统一社会信用代码|統一社會信用代碼|法定代表人|经营范围|經營範圍/.test(zh)) return 'business_license';
  if (/公司设立登记|公司設立登記|企業設立登記|企业设立登记|公司登記表|公司登记表|主体登记/.test(zh) && /公司名称|公司名稱|统一社会信用代码|統一編號|登记编号/.test(zh)) return 'company_registration';
  if (/商标注册证|商標註冊證|trademark\s+registration/i.test(zh)) return 'trademark_certificate';
  if (/品牌手册|品牌手冊|视觉规范|視覺規範|brand\s+manual/i.test(zh)) return 'brand_manual';
  if (/公司介绍|公司介紹|品牌介绍|品牌介紹|company\s+profile|about\s+us/i.test(zh)) return 'company_profile';
  if (/价格表|價格表|报价单|報價單|price\s+list|quotation/i.test(zh)) return 'price_list';
  if (/成分表|配料表|规格表|規格表|ingredient\s+list|specification\s+sheet/i.test(zh)) return 'ingredient_spec';
  if (/商品目录|商品目錄|产品型录|產品型錄|product\s+catalog/i.test(zh) || /(?:SKU|货号|貨號|商品名|产品名称|產品名稱)\s*[:：]/i.test(zh) && /(?:售价|售價|价格|價格|price)\s*[:：]/i.test(zh)) return 'product_catalog';
  if (/AI\s*generated|generated\s+by|产品示意图|產品示意圖|商品展示图|商品展示圖/i.test(zh)) return 'visual_asset';
  return 'unknown';
}

type Rule = { key: string; role: DocumentSubjectRole; labels: string };
const rule = (key: string, role: DocumentSubjectRole, labels: string): Rule => ({ key, role, labels });
const productRules = [rule('productName', 'subject', String.raw`Product\s+Name|Product|Name\s+of\s+Product|产品名称|產品名稱|商品名称|商品名稱|受测样品|受測樣品|样品名称|樣品名稱`), rule('model', 'subject', String.raw`(?:Main\s+|Test\s+)?Model(?:\s+(?:No\.?|Number|Name))?|样品型号|樣品型號|型号规格|型號規格|规格型号|規格型號|型号|型號`), rule('applicantName', 'applicant', String.raw`Applicant(?:\s+Name)?|申请人|申請人|申請單位|申请单位|委托单位|委託單位|委托方|委託方`), rule('manufacturerName', 'manufacturer', String.raw`Manufacturer(?:\s+Name)?|生产者[（(]制造商[）)]|生產者[（(]製造商[）)]|制造商|製造商|生产商|生產商|生产单位|生產單位|制造单位|製造單位`), rule('issuerName', 'issuer', String.raw`Testing\s+Laboratory|Issued\s+by|發文機關|发文机关|发证机构|發證機構|检测机构|檢測機構|机构名称|機構名稱`)];
const reportRules = [rule('reportNo', 'document', String.raw`Report\s*(?:No\.?|Number)|报告编号|報告編號|報告號碼|报告号码|报告号|報告號`), ...productRules,
  rule('sampleNo', 'document', '样品编号|樣品編號'), rule('sampleQuantity', 'document', '样品数量|樣品數量'),
  rule('receiptDate', 'document', String.raw`Date\s+of\s+Receipt|Receipt\s+Date|收样日期|收樣日期|收件日期`),
  rule('testDate', 'document', String.raw`Date\s+of\s+Test|Test\s+period|Test\s+Date|检测日期|檢測日期|检验日期|檢驗日期`),
  rule('issueDate', 'document', String.raw`Date\s+of\s+Issue|Issue\s+Date|签发日期|簽發日期|报告日期|報告日期|签署日期|簽署日期`),
  rule('standards', 'document', String.raw`Test\s+Standards?|Test\s+Specifications?|Tested\s+According\s+To|Standards?|检测标准|檢測標準|试验标准|試驗標準|检验依据|檢驗依據|测试依据|測試依據`),
  rule('documentConclusion', 'document', String.raw`Test\s+Conclusion|检验结论|檢驗結論|检测结论|檢測結論`),
  rule('ratedPower', 'document', String.raw`额定功率(?:[（(]W[）)])?|額定功率(?:[（(]W[）)])?|Rated\s+Power`),
  rule('measuredPower', 'document', String.raw`实测功率(?:[（(]W[）)])?|實測功率(?:[（(]W[）)])?|Measured\s+Power`),
  rule('declaredWavelength', 'document', '标称波长|標稱波長'), rule('measuredPeakWavelength', 'document', '实测峰值波长|實測峰值波長|峰值波长|峰值波長|峰位'), rule('emissivity', 'document', '发射率|發射率')];
const rules: Partial<Record<IntakeDocumentKind, Rule[]>> = {
  conformity_certificate: [rule('certificateNo', 'document', String.raw`Certificate\s*(?:No\.?|Number)|Verification\s*(?:No\.?|Number)|证书编号|證書編號`), ...productRules, rule('linkedReportNo', 'document', String.raw`Related\s+Report\s*(?:No\.?|Number)|Test\s+Report\s*(?:No\.?|Number)|报告编号|報告編號`), rule('issueDate', 'document', String.raw`Date\s+of\s+Issue|Issue\s+Date|Date\s+of\s+Verification|Date|签发日期|簽發日期`), rule('standards', 'document', String.raw`Test\s+Standards?|Test\s+Specifications?|Tested\s+According\s+To|测试标准|測試標準|检测标准|檢測標準`)],
  emc_test_report: reportRules, wavelength_test_report: reportRules, inspection_report: reportRules,
  agency_classification_letter: [rule('letterNo', 'document', '發文字號|发文字号'), rule('addressee', 'subject', '受文者|收文者'), rule('issuerName', 'issuer', '發文機關|发文机关'), rule('productName', 'subject', '產品名稱|产品名称|器材名稱|器材名称'), rule('manufacturerName', 'manufacturer', '製造廠|制造厂|製造商|制造商'), rule('model', 'subject', '型号|型號'), rule('issueDate', 'document', '發文日期|发文日期'), rule('jurisdiction', 'document', '适用地区|適用地區'), rule('classificationText', 'document', '主旨|说明|說明')],
  patent_document: [rule('patentNo', 'document', String.raw`专利号|專利號|Patent\s*(?:No\.?|Number)`), rule('patentTitle', 'subject', '专利名称|專利名稱|实用新型名称|實用新型名稱|发明名称|發明名稱|新型名稱|新型名称|創作名稱|创作名称|設計名稱|设计名称|外观设计名称|外觀設計名稱'), rule('patentHolderName', 'patent_holder', '专利权人|專利權人|Patentee'), rule('inventorName', 'inventor', '发明人|發明人|新型創作人|新型创作人|Inventor'), rule('designerName', 'inventor', '設計人|设计人|Designer'), rule('applicantName', 'applicant', '申请人|申請人|Applicant'), rule('applicationDate', 'document', '专利申请日|專利申請日|申請日|申请日|申请日期|申請日期'), rule('publicationDate', 'document', '授权公告[日目]|授權公告[日目]|公告日|公開日|公开日'), rule('documentDate', 'document', '證書日期|证书日期|發證日期|发证日期'), rule('issuerName', 'issuer', String.raw`发证机关|發證機關|Issued\s+by`)],
  insurance_document: [rule('policyNo', 'document', String.raw`保險單號碼|保险单号码|保险单号|保險單號|保單號碼|保单号码|保单号|保單號|Policy\s*(?:No\.?|Number)`), rule('insuredName', 'insured', '被保险人名称|被保險人名稱|被保险人|被保險人|Insured'), rule('policyHolderName', 'policy_holder', String.raw`要保人|投保人名称|投保人名稱|投保人|Policy\s+Holder`), rule('issuerName', 'issuer', '保险公司|保險公司|Insurer'), rule('coverageAmount', 'document', String.raw`保险金额|保險金額|保额|保額|Sum\s+Insured|Limit\s+of\s+Indemnity`), rule('currency', 'document', '币种|幣種|幣別|币别|Currency'), rule('coverageTerritory', 'document', '承保地区|承保地區|承保區域|适用地区|適用地區|地理范围|地理範圍|Territory'), rule('policyPeriod', 'document', '保險期間|保险期间|保險期限|保险期限'), rule('effectiveFrom', 'document', String.raw`保险起期|保險起期|生效日期|Effective\s+From`), rule('effectiveTo', 'document', String.raw`保险迄期|保險迄期|到期日期|Expiry\s+Date`)],
  authorization_document: [rule('authorizerName', 'authorizer', '授权方|授權方|授权人|授權人|Authori[sz]er'), rule('authorizedPartyName', 'authorized_party', String.raw`被授权方|被授權方|被授权人|被授權人|Authori[sz]ed\s+Party`), rule('authorizationScope', 'document', String.raw`授权范围|授權範圍|Scope\s+of\s+Authori[sz]ation`), rule('referenceNo', 'document', String.raw`授权编号|授權編號|Reference\s*(?:No\.?|Number)`)],
  lab_accreditation: [rule('certificateNo', 'document', String.raw`注册号|註冊號|证书编号|證書編號|证书号|證書號|Accreditation\s*(?:No\.?|Number)`), rule('accreditedLabName', 'subject', String.raw`实验室名称|實驗室名稱|Laboratory\s+Name`), rule('issuerName', 'issuer', String.raw`认可机构|認可機構|Issued\s+by`), rule('effectiveFrom', 'document', '生效日期|有效日期'), rule('effectiveTo', 'document', '到期日期|截止日期'), rule('scope', 'document', String.raw`认可范围|認可範圍|Accreditation\s+Scope`)],
};

function fieldFromPages(pages: DocumentTextPage[], spec: Rule): DocumentFieldCandidate | undefined {
  const allLabels = Object.values(rules).flatMap(specs => specs || []).map(rule => rule.labels).join('|');
  const candidate = extractLabelledDocumentField(pages, spec, allLabels);
  if (candidate && spec.key === 'policyPeriod') {
    const rangeSources = candidate.sources.filter(source => (source.rawText.match(/\d{3,4}\s*年/g) || []).length >= 2);
    if (rangeSources.length) { candidate.sources = rangeSources; delete candidate.conflict; }
  }
  return candidate;
}

function accreditationFields(pages: DocumentTextPage[]) {
  const fields: Record<string, DocumentFieldCandidate> = {};
  const cnasPages = pages.filter(page => /\bCNAS\b/i.test(page.text));
  const chinese = cnasPages.filter(page => /实验室认可证书|實驗室認可證書/.test(documentMarkerText(page.text)));
  const preferred = chinese.length ? chinese : cnasPages;
  // A top-level identity uses one certificate page; other subjects remain in sections.
  const primary = preferred.slice(0, 1);
  const read = (key: string, candidate?: DocumentFieldCandidate) => { if (candidate) fields[key] = candidate; };
  read('certificateNo', candidateFromMatch(primary, /\b(CNAS\s*L\d{3,7})\b/i, 'document', value => value.replace(/\s+/g, ' ')));
  read('issuerName', candidateFromMatch(primary, /^(中国合格评定国家认可委员会|中國合格評定國家認可委員會|China\s+National\s+Accreditation\s+(?:Service|Council)[^\n]*)$/i, 'issuer'));
  read('accreditedLabName', fieldFromPages(primary, rule('accreditedLabName', 'subject', String.raw`实验室名称|實驗室名稱|Laboratory\s+Name`))
    || candidateFromMatch(primary, /^([^\n:：/（）()]{2,80}(?:有限公司|Co[., ]+Ltd\.?))$/i, 'subject'));
  read('legalEntityName', fieldFromPages(primary, rule('legalEntityName', 'subject', String.raw`[（(/]?\s*(?:法人|Legal\s+Entity)`)));
  if (fields.legalEntityName) fields.legalEntityName.value = fields.legalEntityName.value.replace(/[）)]$/, '').trim();
  read('recognitionStandard', candidateFromMatch(primary, /(ISO\s*\/\s*IEC\s*17025\s*:\s*\d{4})/i, 'document', value => value.replace(/\s+/g, '')));
  const criteria = candidateFromMatch(primary, /(CNAS\s*-\s*CL\d{2})/i, 'document', value => value.replace(/\s+/g, ''));
  if (fields.recognitionStandard && criteria) {
    fields.recognitionStandard.value += `; ${criteria.value}`;
    fields.recognitionStandard.sources.push(...criteria.sources);
  }
  read('scope', candidateFromMatch(primary, /^(.*(?:能力范围见|能力範圍見|scope\s+of\s+accreditation\s+is\s+detailed)[^\n]*)$/i, 'document'));
  for (const spec of (rules.lab_accreditation || []).filter(spec => ['effectiveFrom', 'effectiveTo'].includes(spec.key))) read(spec.key, fieldFromPages(primary, spec));
  const cmaPages = pages.filter(page => isCmaCertificateText(page.text)).slice(0, 1);
  const cmaRules = [rule('cmaSubjectName', 'subject', '名称|名稱'), rule('cmaCertificateNo', 'document', '证书编号|證書編號'), rule('cmaIssueDate', 'document', '发证日期|發證日期'), rule('cmaExpiryDate', 'document', '有效至'), rule('cmaIssuerName', 'issuer', '发证机关|發證機關')];
  for (const spec of cmaRules) read(spec.key, extractLabelledDocumentField(cmaPages, spec, cmaRules.map(spec => spec.labels).join('|')));
  if (!fields.cmaIssuerName) read('cmaIssuerName', candidateFromMatch(cmaPages, /((?:[^\s:：]{2,12}省)?市场监督管理局|(?:[^\s:：]{2,12}省)?市場監督管理局)/, 'issuer'));
  read('cmaDocumentRegion', candidateFromMatch(cmaPages, /(中华人民共和国境内|中華人民共和國境內)/, 'document'));
  return fields;
}

function enrichDocumentFields(kind: IntakeDocumentKind, pages: DocumentTextPage[], fields: Record<string, DocumentFieldCandidate>) {
  if (kind === 'lab_accreditation') fields = accreditationFields(pages);
  const whole = pages.map(page => page.text).join('\n');
  const rocContext = /民國|民国|中華民國|中华民国/.test(whole);
  for (const [key, candidate] of Object.entries(fields)) {
    if (key === 'testDate') {
      const dates = candidate.value.match(/\d{4}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}\s*日?/g) || [];
      const normalized = dates.map(value => documentDate(value)).filter(Boolean);
      if (normalized.length) candidate.value = normalized.join(' 至 ');
    }
    if (['ratedPower', 'measuredPower'].includes(key) && /^\d+(?:\.\d+)?$/.test(candidate.value)
      && candidate.sources.some(source => /[（(]\s*W\s*[）)]/i.test(source.rawText))) candidate.value += ' W';
    if (key === 'standards') candidate.value = candidate.value.replace(/[—–]/g, '-');
    if (/Date$|^effectiveFrom$|^effectiveTo$/.test(key) && (candidate.value.match(/\d{3,4}\s*(?:年|[-/])/g) || []).length < 2) {
      const normalized = documentDate(candidate.value, rocContext);
      if (normalized) candidate.value = normalized;
    }
    if (/No$/.test(key) && key !== 'policyNo') {
      const id = candidate.value.match(/(?:ZL\s*)?[A-Z0-9][A-Z0-9./ -]{3,80}/i)?.[0]?.trim();
      if (id) candidate.value = id;
    }
  }
  if (kind === 'insurance_document') {
    if (!fields.productName) fields.productName = fieldFromPages(pages, rule('productName', 'subject', '被保險產品名稱|被保险产品名称|(?:\\d+[.、]\\s*)?產品名稱|(?:\\d+[.、]\\s*)?产品名称'))!;
    if (!fields.issuerName) fields.issuerName = candidateFromMatch(pages, /^([^\n]{2,80}保[险險](?:股份)?有限公司)$/, 'issuer')!;
    if (!fields.currency) fields.currency = candidateFromMatch(pages, /(新臺幣|新台幣|新台币|NT\$|TWD|人民幣|人民币|RMB|CNY)/i, 'document', value => /新|NT|TWD/i.test(value) ? 'TWD' : 'CNY')!;
    if (fields.currency) {
      if (/新臺幣|新台幣|TWD|NT\$/i.test(fields.currency.value)) fields.currency.value = 'TWD';
      else if (/人民幣|人民币|RMB|CNY/i.test(fields.currency.value)) fields.currency.value = 'CNY';
    }
    if (!fields.coverageTerritory) fields.coverageTerritory = candidateFromMatch(pages, /(台[澎彭]金馬(?:地區)?|台[澎彭]金马(?:地区)?|中[华華]人民共和国[^。\n]{0,60}(?:港澳台|港、澳、台)[^。\n]{0,20})/, 'document')!;
    const period = fields.policyPeriod;
    if (period) {
      const timeWords = documentMarkerText(period.value).replace(/二十四时/g, '24时').replace(/零时/g, '0时').replace(/中午\s*/g, '');
      const dateParts = timeWords.match(/(?:民国)?\s*\d{3,4}\s*(?:年|[./-])\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*日?(?:\s*\d{1,2}\s*(?:时|:)\s*\d{0,2}\s*分?)?/g) || [];
      if (dateParts.length >= 2) {
        const from = documentDate(dateParts[0] || '', rocContext), to = documentDate(dateParts[1] || '', rocContext);
        if (from && !fields.effectiveFrom) fields.effectiveFrom = { ...period, value: from };
        if (to && !fields.effectiveTo) fields.effectiveTo = { ...period, value: to };
      }
    }
  }
  if (kind === 'patent_document') {
    if (!fields.patentNo) fields.patentNo = candidateFromMatch(pages, /^([A-Z]\d{5,8})$/, 'document')!;
    if (!fields.patentNo) fields.patentNo = candidateFromMatch(pages, /(?:新型|發明|发明|設計|设计)?\s*第?\s*([A-Z]\s*\d{5,8})\s*[號号]/, 'document', value => value.replace(/\s/g, ''))!;
    if (!fields.issuerName) fields.issuerName = candidateFromMatch(pages, /(中[华華]人民共和[國国][國国]家[知智][识識]產?[权權]局|國家知識產權局|国家知识产权局|經濟部智慧財產局|经济部智慧财产局)/, 'issuer')!;
  }
  if (['inspection_report', 'wavelength_test_report', 'emc_test_report', 'conformity_certificate'].includes(kind)) {
    if (!fields.issuerName) fields.issuerName = candidateFromMatch(pages, /^([^\n:：]{2,70}(?:质量检测|質量檢測|检验检测|檢驗檢測)有限公司)$/, 'issuer')!;
    const finalJudgment = candidateFromMatch(pages, /^Final\s+Judgment\s*[:：]\s*(PASS|FAIL|N\/A)\b/i, 'document');
    if (finalJudgment) fields.documentConclusion = finalJudgment;
    if (!fields.issuerName) fields.issuerName = candidateFromMatch(pages, /^([^\n]{2,70}Testing\s+Co\.,?\s*Ltd\.?)$/i, 'issuer')!;
    if (!fields.issuerName) fields.issuerName = candidateFromMatch(pages, /((?:广东省|廣東省)[^\n]{2,60}(?:研究所|检验站|檢驗站)|[^\n]{2,70}(?:Testing\s+Service|Test\s+Service|Laboratory|实验室|實驗室)(?:\s+Co\.,?\s*Ltd\.?)?)/i, 'issuer')!;
    const institute = candidateFromMatch(pages, /^((?:广东省|廣東省)[^\n]{2,60}研究所)$/, 'issuer');
    const station = candidateFromMatch(pages, /^((?:广东省|廣東省)[^\n]{2,60}(?:检验站|檢驗站))$/, 'issuer');
    if (institute && station && institute.sources[0].page === station.sources[0].page && fields.issuerName?.value === institute.value) {
      fields.issuerName = { value: `${institute.value} / ${station.value}`, role: 'issuer', sources: [...institute.sources, ...station.sources], needsReview: true };
    }
  }
  if (kind === 'agency_classification_letter' && !fields.issuerName) fields.issuerName = candidateFromMatch(pages, /(衛生福利部食品藥物管理署|衛生福利部|卫生福利部食品药物管理署|卫生福利部)/, 'issuer')!;
  for (const key of Object.keys(fields)) if (!fields[key]) delete fields[key];
  Object.assign(fields, supplementalDocumentFields(kind, pages));
  return fields;
}

export function identifyBrandDocument(fileName: string, mime: string, pages: DocumentTextPage[]): DocumentIdentification {
  const sensitivePages = pages.filter(page => page.sensitive || isSensitiveDocumentPage(page.text)).map(page => page.page);
  const readable = pages.filter(page => meaningful(page.text) && !sensitivePages.includes(page.page));
  const text = readable.map(page => page.text).join('\n');
  const pageKinds = readable.map(page => ({ page: page.page, kind: contentKind(page.text) }));
  pageKinds.push(...sensitivePages.map(page => ({ page, kind: 'sensitive_document' as const })));
  const kinds = Array.from(new Set(pageKinds.map(page => page.kind).filter(kind => kind !== 'unknown')));
  const companyBundle = kinds.every(kind => ['business_license', 'company_registration'].includes(kind));
  const reportBundle = kinds.every(kind => ['inspection_report', 'wavelength_test_report', 'emc_test_report'].includes(kind));
  let kind = (reportBundle && kinds.includes('wavelength_test_report') ? 'wavelength_test_report' : reportBundle && kinds.includes('emc_test_report') ? 'emc_test_report' : kinds.length > 1 && !companyBundle ? 'mixed_document' : kinds.includes('business_license') && companyBundle ? 'business_license' : kinds.length ? kinds[0] : contentKind(text)) as IntakeDocumentKind;
  if (kind === 'inspection_report' && /光谱|波长|谱图/i.test(documentMarkerText(text))) kind = 'wavelength_test_report';
  const filenameHint = contentKind(fileName);
  const filenamePartHint = /草稿|draft/i.test(fileName) ? 'draft' : /封面|cover/i.test(fileName) ? 'cover' : undefined;
  const sourcePart = /(?:^|\n)\s*(?:DRAFT|草稿|草本)(?:\s|$)/im.test(text) ? 'draft' : /报告封面|報告封面|cover\s+sheet/i.test(text) ? 'cover' : undefined;
  const reportType = ['emc_test_report', 'wavelength_test_report', 'inspection_report'].includes(kind);
  const shortCover = reportType && pages.length === 1 && !/test\s+results?|检测结果|檢測結果|检验结果|檢驗結果|实测|實測|measured/i.test(text) && text.length < 1200;
  const relatedKind = sourcePart === 'cover' || shortCover ? kind : undefined;
  if (relatedKind && reportType) kind = 'document_cover';
  const fields = enrichDocumentFields(relatedKind || kind, readable, Object.fromEntries((rules[relatedKind || kind] || []).map(spec => [spec.key, fieldFromPages(readable, spec)]).filter(([, value]) => value)) as Record<string, DocumentFieldCandidate>);
  const sections = kinds.flatMap((kind): DocumentIdentification['sections'] => {
    const sectionPages = readable.filter(page => pageKinds.some(item => item.page === page.page && item.kind === kind));
    if (kind === 'lab_accreditation') return sectionPages.map(page => {
      const fields = enrichDocumentFields(kind, [page], {});
      const scheme = isCmaCertificateText(page.text) ? 'CMA' as const : 'CNAS' as const;
      return { kind, pages: [page.page], fields, subjectRef: { scheme, certificateNo: fields[scheme === 'CMA' ? 'cmaCertificateNo' : 'certificateNo']?.value } };
    });
    return [{ kind, pages: sectionPages.map(page => page.page), fields: enrichDocumentFields(kind, sectionPages, Object.fromEntries((rules[kind] || []).map(spec => [spec.key, fieldFromPages(sectionPages, spec)]).filter(([, value]) => value)) as Record<string, DocumentFieldCandidate>) }];
  });
  const warnings = ['仅生成资料候选；文件分类和日期读取不等于真实性、法律效力、产品许可或疗效审核。'];
  if (!readable.length) warnings.push('未读到可靠内容，文件保留为待确认；文件名仅作提示。');
  if (kind === 'mixed_document') warnings.push('文件内包含不同类型资料，已分段保留；不得混填同一个公司或品牌身份。');
  if (sensitivePages.length) warnings.push('含银行或凭证敏感页面，仅保留原件；敏感内容不会进入预览、字段或商品草稿。');
  if (filenamePartHint && filenamePartHint !== sourcePart) warnings.push(`文件名提示${filenamePartHint === 'draft' ? '草稿' : '封面'}，内容状态仍需人工确认。`);
  if (['conformity_certificate', 'emc_test_report', 'wavelength_test_report', 'inspection_report', 'patent_document'].includes(kind)) warnings.push('检测、CE/EMC或专利资料不能当成医疗疗效证据或上市许可。');
  if (kind === 'agency_classification_letter') warnings.push('机关函仅按原文产品与地区理解，不扩大适用范围。');
  if (kind === 'insurance_document') warnings.push('保险期限、区域和币种各自待核对；日期提示不是保单效力审核。');
  if (mime.startsWith('image/') && kind === 'unknown') warnings.push('图片仅存为未验证视觉素材候选；不能当成真实产品实拍或证书。');
  return { kind, confidence: kind === 'unknown' ? 0 : 0.72, part: sourcePart || (shortCover ? 'cover' : readable.length ? 'body' : 'unknown'), ...(relatedKind ? { relatedKind } : {}), ...(filenameHint !== 'unknown' ? { filenameHint } : {}), ...(filenamePartHint ? { filenamePartHint } : {}), signals: readable.filter(page => contentKind(page.text) !== 'unknown').map(page => ({ page: page.page, rawText: page.text.split('\n').filter(Boolean).slice(0, 3).join('\n').slice(0, 500) })), fields, pageKinds, sections, sensitivePages, needsReview: true, warnings };
}
