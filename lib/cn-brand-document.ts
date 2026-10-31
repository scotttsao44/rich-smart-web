import { parseBusinessLicenseText } from './cn-business-license-ocr';

export type BrandDocumentDraft = {
  companyName?: string;
  registrationNo?: string;
  legalRepresentative?: string;
  companyType?: string;
  registeredCapital?: string;
  establishmentDate?: string;
  companyAddress?: string;
  businessScope?: string;
  brandName?: string;
  contactName?: string;
  phone?: string;
  introduction?: string;
};

function compact(value: string) {
  return value.replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function match(text: string, expression: RegExp) {
  return compact(text.match(expression)?.[1] || '');
}

export function brandDraftFromDocumentText(source: string, kind: string) {
  const text = source.replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n');
  const lines = text.split('\n').map(compact).filter(Boolean);
  const registrationNo = match(text, /(?:统一社会信用代码|注册号|登记编号|registration\s*(?:no|number)|company\s*id)[\s：:]*([0-9A-Z]{8,24})/i);
  const labelledCompany = match(text, /(?:企业名称|公司名称|名称|company\s*name)[\s：:]*([^\n，,。]{3,80})/i);
  const companyLine = lines.find((line) => /(?:有限责任公司|股份有限公司|有限公司)$/.test(line)) || '';
  const brandName = match(text, /(?:品牌名称|品牌|商标名称|brand\s*name)[\s：:]*([^\n，,。]{2,40})/i);
  const contactName = match(text, /(?:联系人|负责人|contact\s*(?:name|person))[\s：:]*([^\n，,。]{2,20})/i);
  const phone = match(text, /(?:联系电话|手机|电话|phone|mobile)[\s：:]*(1[3-9]\d{9}|(?:\d{3,4}-)?\d{7,8})/i);
  const paragraph = lines.filter((line) => line.length >= 16 && !/^[0-9A-Z\s-]+$/.test(line)).slice(0, 4).join('\n').slice(0, 600);
  const draft: BrandDocumentDraft = {};
  if (labelledCompany || companyLine) draft.companyName = labelledCompany || companyLine;
  if (registrationNo) draft.registrationNo = registrationNo;
  if (brandName) draft.brandName = brandName;
  if (contactName) draft.contactName = contactName;
  if (phone) draft.phone = phone;
  if (kind === 'license') Object.assign(draft, parseBusinessLicenseText(source, 'pdf-text').draft);
  if (kind === 'profile' && paragraph) draft.introduction = paragraph;
  return draft;
}
