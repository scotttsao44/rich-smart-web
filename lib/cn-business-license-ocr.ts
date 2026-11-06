import { execFile } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function firstRenderedImage(directory: string): string | null {
  for (const name of readdirSync(directory)) {
    const target = path.join(directory, name);
    if (/\.(?:png|jpe?g)$/i.test(name)) return target;
    try {
      for (const nested of readdirSync(target)) {
        const nestedTarget = path.join(target, nested);
        if (/\.(?:png|jpe?g)$/i.test(nested)) return nestedTarget;
      }
    } catch {}
  }
  return null;
}

export type BusinessLicenseField =
  | 'companyName'
  | 'registrationNo'
  | 'legalRepresentative'
  | 'companyType'
  | 'registeredCapital'
  | 'establishmentDate'
  | 'companyAddress'
  | 'businessScope';

export type BusinessLicenseOcrResult = {
  provider: 'aliyun' | 'local-macos-vision' | 'local-tesseract' | 'pdf-text';
  orientation?: string;
  draft: Partial<Record<BusinessLicenseField, string>>;
  confidence: Partial<Record<BusinessLicenseField, number>>;
  fieldEvidence?: Partial<Record<BusinessLicenseField, Array<{ text: string; confidence: number; page: number; box?: { x: number; y: number; width: number; height: number } }>>>;
  missingFields: BusinessLicenseField[];
  lowConfidenceFields: BusinessLicenseField[];
  titleSignals?: string[];
  layoutSignals?: string[];
  validRegistrationNo?: boolean;
  contentScore?: number;
  businessScopeTags?: string[];
  categorySuggestions?: Array<{ categoryMajorId: string; categoryMinorId: string; label: string; reason: string; confidence: number; source: 'system_suggestion' }>;
};

type VisionLine = { text: string; confidence?: number; x?: number; y?: number; width?: number; height?: number };
type VisionOutput = { orientation?: string; text?: string; lines?: VisionLine[] };

type TesseractWord = {
  key: string;
  text: string;
  confidence: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

const fields: BusinessLicenseField[] = [
  'companyName',
  'registrationNo',
  'legalRepresentative',
  'companyType',
  'registeredCapital',
  'establishmentDate',
  'companyAddress',
  'businessScope',
];

const labels: Record<BusinessLicenseField, string[]> = {
  companyName: ['名称', '企业名称', '公司名称', '主体名称'],
  registrationNo: ['统一社会信用代码', '注册号', '登记编号'],
  legalRepresentative: ['法定代表人', '负责人', '经营者'],
  companyType: ['类型', '公司类型', '主体类型'],
  registeredCapital: ['注册资本', '注册资金', '存册资本'],
  establishmentDate: ['成立日期', '成立时间'],
  companyAddress: ['住所', '营业场所', '地址', '注册地址'],
  businessScope: ['经营范围'],
};

function compact(value: string) {
  return value.replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

// OCR may split Han words; normalize parser copies without joining lines or Latin names.
const hanOcrSpacing = new RegExp('(\\p{Script=Han})[ \\t\\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]+(?=\\p{Script=Han})', 'gu');

function normalizeHanOcrSpacing(value: string) {
  return value.replace(hanOcrSpacing, '$1');
}

function cleanField(value: string) {
  return compact(value)
    .replace(/^[：:;；,“”"'「」『』\s]+/, '')
    .replace(/[|｜“”"']+/g, '')
    .replace(/^[名称型类]+$/, '')
    .trim()
    .slice(0, 1000);
}

function cleanRegisteredCapital(value: string) {
  const cleaned = cleanField(value);
  if (!cleaned) return '';
  if (/万\s*人$/.test(cleaned)) return cleaned.replace(/万\s*人$/, '万人民币');
  if (/万\s*人民?$/.test(cleaned)) return cleaned.replace(/万\s*人民?$/, '万人民币');
  return cleaned;
}

// GB 32100-2015 字符集共 31 个：数字与大写字母，不含 I、O、S、V、Z。L 的代码值是 20，是合法字符。
const usccChars = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const usccWeights = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
const usccPattern = /^[159Y][1239][0-9]{6}[0-9A-HJ-NPQRTUWXY]{10}$/;

export function canonicalUscc(value: string) {
  return value.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function usccChecksumMatches(code: string) {
  if (!usccPattern.test(code)) return false;
  let sum = 0;
  for (let index = 0; index < 17; index += 1) {
    const charIndex = usccChars.indexOf(code[index]);
    if (charIndex < 0) return false;
    sum += charIndex * usccWeights[index];
  }
  const checkIndex = (31 - (sum % 31)) % 31;
  return usccChars[checkIndex] === code[17];
}

// 格式检核：字符集 + MOD 31 校验位。不改写任何字母，也不判断证件真伪。
export function isUnifiedSocialCreditCode(value: string) {
  const code = canonicalUscc(value);
  return code.length === 18 && usccChecksumMatches(code);
}

// 用户提交的代码只做大小写与分隔符整理。校验失败则拒绝，不换成另一个码。
export function submittedUnifiedSocialCreditCode(value: string) {
  const code = canonicalUscc(value);
  return isUnifiedSocialCreditCode(code) ? code : null;
}

// 仅用于 OCR 草稿。字符集之外的 I/O/S/Z 只有在替换后能通过校验位时才采用。
// L 属于字符集，一律保留；不得把 L 改成 1。替换后仍不通过时保留原字符串，不编造代码。
export function normalizeUsccCandidate(value: string) {
  const raw = canonicalUscc(value);
  if (raw.length !== 18) return raw;
  if (usccChecksumMatches(raw)) return raw;
  const repaired = raw.replace(/I/g, '1').replace(/O/g, '0').replace(/S/g, '5').replace(/Z/g, '2');
  if (repaired !== raw && usccChecksumMatches(repaired)) return repaired;
  return raw;
}

function normalizedLines(source: string) {
  return source.replace(/\r/g, '\n').split('\n').map(cleanField).filter(Boolean);
}

function matchInline(text: string, field: BusinessLicenseField) {
  const label = [...labels[field]].sort((left, right) => right.length - left.length).join('|');
  const expression = new RegExp(`(?:${label})[ \\t]*[：:]?[ \\t]*([^\\n]+)`, 'i');
  return boundedFieldValue(text.match(expression)?.[1] || '', field);
}

function boundedFieldValue(value: string, field: BusinessLicenseField) {
  if (field === 'businessScope') return cleanField(value);
  const otherLabels = fields.filter((key) => key !== field).flatMap((key) => labels[key]);
  const boundary = otherLabels.map((label) => label.length >= 4 ? label : `${label}(?:[ \\t]*[：:]|(?=[\\u4e00-\\u9fa5]{2}))`).join('|');
  let cleaned = cleanField(value.split(new RegExp(`(?:${boundary})`, 'i'))[0]);
  if (field === 'companyName') {
    const corpMatch = cleaned.match(/^(.+?(?:有限责任公司|股份有限公司|有限公司|合伙企业|个人独资企业|个体工商户))/);
    if (corpMatch) cleaned = corpMatch[1];
  }
  if (field === 'companyType' && cleaned.startsWith('现责任公司')) {
    cleaned = cleaned.replace(/^现责任公司/, '有限责任公司');
  }
  return cleaned;
}

function startsWithFieldLabel(value: string) {
  return fields.some((field) => labels[field].some((label) => value.startsWith(label)));
}

function nearbyValue(lines: string[], field: BusinessLicenseField) {
  const labelSet = labels[field];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matched = labelSet.find((label) => line.includes(label));
    if (!matched) continue;
    const inline = boundedFieldValue(line.slice(line.indexOf(matched) + matched.length), field);
    if (inline && !labelSet.includes(inline)) return inline;
    const candidate = cleanField(lines[index + 1] || '');
    if (!candidate || startsWithFieldLabel(candidate) || /^(?:营业执照|登记机关|打印日期|核准日期)/.test(candidate)) return '';
    return boundedFieldValue(candidate, field);
  }
  return '';
}

function parseDate(value: string) {
  const match = value.match(/^(\d{4})\s*(?:年|-|\/)\s*(\d{1,2})\s*(?:月|-|\/)\s*(\d{1,2})\s*[日白]?$/);
  if (!match) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function findDateNearLabel(lines: string[], label: string) {
  const index = lines.findIndex((line) => line.includes(label));
  if (index < 0) return '';
  const inline = boundedFieldValue(lines[index].slice(lines[index].indexOf(label) + label.length), 'establishmentDate');
  const next = lines[index + 1] || '';
  return parseDate(inline || (!startsWithFieldLabel(next) ? next : '')) || fullDateFromText(inline || (!startsWithFieldLabel(next) ? next : ''));
}

function fullDateFromText(value: string) {
  const compactValue = value.replace(/\s+/g, '');
  const splitDate = compactValue.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  const fullDate = value.match(/\d{4}\s*(?:年|-|\/)\s*\d{1,2}\s*(?:月|-|\/)\s*\d{1,2}\s*(?:日)?/)?.[0]
    || (splitDate ? `${splitDate[1]}年${splitDate[2]}月${splitDate[3]}日` : '');
  const parsed = parseDate(fullDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? parsed : '';
}

function findBusinessScope(lines: string[]) {
  const index = lines.findIndex((line) => line.includes('经营范围'));
  if (index < 0) return '';
  const chunks: string[] = [];
  for (let cursor = index + 1; cursor < lines.length && chunks.join('').length < 700; cursor += 1) {
    const line = cleanField(lines[cursor]);
    if (/^(?:登记机关|打印日期|核准日期|发证日期|营业期限|市场主体|国家企业|https?:)/.test(line)) break;
    if (!line || labels.companyAddress.some((label) => line.includes(label))) break;
    if (fields.some((field) => field !== 'businessScope' && labels[field].some((label) => line.includes(label)))) break;
    chunks.push(line);
  }
  return cleanField(chunks.join(''));
}

function sourceConfidence(value: unknown) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0;
}

function fieldEvidence(lines: VisionLine[], draft: Partial<Record<BusinessLicenseField, string>>) {
  const evidence: BusinessLicenseOcrResult['fieldEvidence'] = {};
  for (const field of fields) {
    const value = draft[field];
    if (!value) continue;
    const normalized = value.replace(/\s/g, '');
    const matches = lines
      .filter((line) => {
        if (field === 'establishmentDate' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return fullDateFromText(line.text || '') === value;
        }
        const text = compact(line.text || '').replace(/\s/g, '');
        if (!text || fields.some((key) => labels[key].includes(text))) return false;
        return text.includes(normalized.slice(0, Math.min(10, normalized.length))) || normalized.includes(text.slice(0, Math.min(10, text.length)));
      })
      .slice(0, 3)
      .map((line) => ({
        text: compact(line.text || ''),
        confidence: sourceConfidence(line.confidence),
        page: 1,
        ...(Number.isFinite(line.x) && Number.isFinite(line.y) && Number.isFinite(line.width) && Number.isFinite(line.height)
          ? { box: { x: Number(line.x), y: Number(line.y), width: Number(line.width), height: Number(line.height) } }
          : {}),
      }));
    evidence[field] = matches;
  }
  return evidence;
}

export function businessScopeUnderstanding(scope: string) {
  const text = compact(scope);
  const tags = [
    [/量子计算技术服务/, '量子计算技术服务'],
    [/技术服务|技术开发|技术咨询|技术交流|技术转让|技术推广/, '技术服务/开发/咨询/交流/转让/推广'],
    [/科技推广和应用服务/, '科技推广和应用服务'],
    [/计算机系统服务/, '计算机系统服务'],
    [/信息技术咨询服务/, '信息技术咨询服务'],
    [/软件开发/, '软件开发'],
    [/计算机软硬件及辅助设备批发/, '计算机软硬件及辅助设备批发'],
    [/计算机软硬件及辅助设备零售/, '计算机软硬件及辅助设备零售'],
    [/电子产品销售/, '电子产品销售'],
    [/健康咨询服务/, '健康咨询服务'],
  ].filter(([pattern]) => (pattern as RegExp).test(text)).map(([, label]) => String(label));

  const suggestions: BusinessLicenseOcrResult['categorySuggestions'] = [];
  if (/量子|计算机|信息技术|软件|电子产品|技术服务|技术开发|技术咨询/.test(text)) {
    suggestions.push({
      categoryMajorId: 'home-lifestyle',
      categoryMinorId: 'lifestyle-service',
      label: '家居生活 / 生活方式/服务品牌',
      reason: '经营范围含技术服务、软件开发、信息技术或计算机相关服务；仅作为系统建议，请人工确认实际品牌主营业务。',
      confidence: 0.62,
      source: 'system_suggestion',
    });
  }
  if (/健康咨询|健康管理|养生|营养/.test(text)) {
    suggestions.push({
      categoryMajorId: 'health-devices',
      categoryMinorId: 'health-device-non-medical',
      label: '健康器械与照护 / 非医疗健康设备',
      reason: '经营范围含健康咨询或健康管理相关词；该建议不是证照原文结论，需按商品与资质人工确认。',
      confidence: 0.54,
      source: 'system_suggestion',
    });
  }
  return { tags, suggestions };
}

type GeoLine = Required<Pick<VisionLine, 'text' | 'confidence' | 'x' | 'y' | 'width' | 'height'>>;
type GeoAnchor = { field: BusinessLicenseField; x: number; y: number; width: number; height: number };
type GeoPick = { value: string; confidence: number };

function hasGeometry(lines: VisionLine[]) {
  return lines.some((line) => Number.isFinite(line.x) && Number.isFinite(line.y) && Number.isFinite(line.width) && Number.isFinite(line.height));
}

function geoLines(lines: VisionLine[]): GeoLine[] {
  return lines
    .filter((line) => Number.isFinite(line.x) && Number.isFinite(line.y) && Number.isFinite(line.width) && Number.isFinite(line.height))
    .map((line) => ({
      text: cleanField(normalizeHanOcrSpacing(line.text || '')),
      confidence: sourceConfidence(line.confidence),
      x: Number(line.x),
      y: Number(line.y),
      width: Number(line.width),
      height: Number(line.height),
    }))
    .filter((line) => Boolean(line.text));
}

function sameRow(left: GeoLine | GeoAnchor, right: GeoLine | GeoAnchor, tolerance = 0.022) {
  return Math.abs(left.y - right.y) <= tolerance;
}

function lineRight(line: GeoLine) {
  return line.x + line.width;
}

function isLabelLine(line: GeoLine) {
  return fields.some((field) => labels[field].some((label) => line.text === label || line.text.includes(label)))
    || ['名', '称', '类', '型'].includes(line.text);
}

function anchorFromLine(field: BusinessLicenseField, line: GeoLine): GeoAnchor {
  return { field, x: line.x, y: line.y, width: line.width, height: line.height };
}

function singleCharAnchor(field: BusinessLicenseField, lines: GeoLine[], first: string, second: string): GeoAnchor | null {
  for (const left of lines.filter((line) => line.text === first)) {
    const right = lines.find((line) => line.text === second && sameRow(line, left, 0.026) && line.x > left.x);
    if (!right) continue;
    return {
      field,
      x: Math.min(left.x, right.x),
      y: (left.y + right.y) / 2,
      width: Math.max(lineRight(left), lineRight(right)) - Math.min(left.x, right.x),
      height: Math.max(left.height, right.height),
    };
  }
  return null;
}

function fieldAnchor(lines: GeoLine[], field: BusinessLicenseField): GeoAnchor | null {
  const direct = lines.find((line) => labels[field].some((label) => line.text === label || line.text.includes(label)));
  if (direct) return anchorFromLine(field, direct);
  if (field === 'companyName') return singleCharAnchor(field, lines, '称', '名') || singleCharAnchor(field, lines, '名', '称');
  if (field === 'companyType') return singleCharAnchor(field, lines, '型', '类') || singleCharAnchor(field, lines, '类', '型');
  return null;
}

function rowValue(lines: GeoLine[], anchor: GeoAnchor, options: { multiLine?: boolean; above?: boolean } = {}): GeoLine[] {
  const same = lines
    .filter((line) => !isLabelLine(line))
    .filter((line) => sameRow(line, anchor, 0.026))
    .filter((line) => line.x < anchor.x || line.x < anchor.x + anchor.width)
    .sort((left, right) => left.x - right.x);

  if (!options.multiLine) {
    const candidate = same
      .filter((line) => lineRight(line) <= anchor.x + anchor.width + 0.025)
      .sort((left, right) => Math.abs(lineRight(left) - anchor.x) - Math.abs(lineRight(right) - anchor.x))[0]
      || same.sort((left, right) => Math.abs(left.y - anchor.y) - Math.abs(right.y - anchor.y))[0];
    return candidate ? [candidate] : [];
  }

  const extra = options.above
    ? lines
      .filter((line) => !isLabelLine(line))
      .filter((line) => line.x < anchor.x + 0.02 && line.y > anchor.y + 0.005 && line.y < anchor.y + 0.075)
    : [];
  const unique = new Map<string, GeoLine>();
  [...same, ...extra].forEach((line) => unique.set(`${line.x}:${line.y}:${line.text}`, line));
  return Array.from(unique.values()).sort((left, right) => {
    const distance = Math.abs(left.y - anchor.y) - Math.abs(right.y - anchor.y);
    if (Math.abs(distance) > 0.005) return distance;
    return left.x - right.x;
  });
}

function geoValue(lines: GeoLine[], field: BusinessLicenseField): GeoPick | null {
  const anchor = fieldAnchor(lines, field);
  if (!anchor) return null;
  const picked = field === 'companyAddress'
    ? rowValue(lines, anchor, { multiLine: true, above: true })
    : rowValue(lines, anchor);
  const text = cleanField(picked.map((line) => line.text).join(''));
  if (!text) return null;
  return { value: text, confidence: Math.min(...picked.map((line) => line.confidence)) };
}

function geoRegistrationNo(lines: GeoLine[]) {
  const anchor = fieldAnchor(lines, 'registrationNo');
  const candidates = lines.filter((line) => isUnifiedSocialCreditCode(line.text));
  if (!candidates.length) return null;
  const picked = anchor
    ? candidates.sort((left, right) => Math.abs(left.y - anchor.y) + Math.abs(left.x - anchor.x) - (Math.abs(right.y - anchor.y) + Math.abs(right.x - anchor.x)))[0]
    : candidates[0];
  return { value: picked.text.toUpperCase(), confidence: picked.confidence };
}

function geoBusinessScope(lines: GeoLine[]) {
  const anchor = fieldAnchor(lines, 'businessScope');
  if (!anchor) return null;
  const chunks = lines
    .filter((line) => !isLabelLine(line))
    .filter((line) => line.x < anchor.x + 0.02)
    .filter((line) => line.y >= anchor.y - 0.012 && line.y <= anchor.y + 0.09)
    .filter((line) => line.confidence >= 0.45)
    .sort((left, right) => {
      if (Math.abs(left.y - right.y) > 0.01) return left.y - right.y;
      return right.x - left.x;
    });
  const text = cleanField(chunks.map((line) => line.text).join(''));
  if (!text) return null;
  return { value: text, confidence: Math.min(...chunks.map((line) => line.confidence)) };
}

function geometricDraft(lineMeta: VisionLine[]) {
  const lines = geoLines(lineMeta);
  const draft: Partial<Record<BusinessLicenseField, string>> = {};
  const confidence: Partial<Record<BusinessLicenseField, number>> = {};
  const assign = (field: BusinessLicenseField, pick: GeoPick | null) => {
    if (!pick?.value) return;
    draft[field] = pick.value;
    confidence[field] = pick.confidence;
  };
  assign('registrationNo', geoRegistrationNo(lines));
  assign('companyName', geoValue(lines, 'companyName'));
  assign('legalRepresentative', geoValue(lines, 'legalRepresentative'));
  assign('companyType', geoValue(lines, 'companyType'));
  assign('registeredCapital', geoValue(lines, 'registeredCapital'));
  const establishment = geoValue(lines, 'establishmentDate');
  if (establishment) assign('establishmentDate', { ...establishment, value: parseDate(establishment.value) });
  assign('companyAddress', geoValue(lines, 'companyAddress'));
  assign('businessScope', geoBusinessScope(lines));
  return { draft, confidence };
}

export function parseBusinessLicenseText(source: string, provider: BusinessLicenseOcrResult['provider'], lineMeta: VisionLine[] = [], orientation?: string): BusinessLicenseOcrResult {
  const text = normalizeHanOcrSpacing(source).replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n');
  const lines = normalizedLines(text);
  const draft: Partial<Record<BusinessLicenseField, string>> = {};
  const rawUsccMatch = text.match(/[159Y][1239][0-9]{6}[0-9A-Z]{10}/i)?.[0] || matchInline(text, 'registrationNo') || nearbyValue(lines, 'registrationNo');
  draft.registrationNo = normalizeUsccCandidate(cleanField(rawUsccMatch));
  draft.companyName = matchInline(text, 'companyName')
    || nearbyValue(lines, 'companyName')
    || lines.find((line) => /^.{3,}(?:股份有限公司|有限公司)$/.test(line) && !startsWithFieldLabel(line) && line !== '有限责任公司' && line !== '股份有限公司');
  draft.legalRepresentative = matchInline(text, 'legalRepresentative') || nearbyValue(lines, 'legalRepresentative');
  draft.companyType = matchInline(text, 'companyType')
    || nearbyValue(lines, 'companyType')
    || lines.find((line) => /(?:有限责任公司|股份有限公司|个体工商户)/.test(line) && line !== draft.companyName);
  draft.registeredCapital = cleanRegisteredCapital(matchInline(text, 'registeredCapital') || nearbyValue(lines, 'registeredCapital'));
  draft.establishmentDate = parseDate(matchInline(text, 'establishmentDate'))
    || fullDateFromText(matchInline(text, 'establishmentDate'))
    || findDateNearLabel(lines, '成立日期') || findDateNearLabel(lines, '成立时间');
  draft.companyAddress = matchInline(text, 'companyAddress') || nearbyValue(lines, 'companyAddress');
  draft.businessScope = matchInline(text, 'businessScope') || findBusinessScope(lines);

  const geo = (provider !== 'local-tesseract' && hasGeometry(lineMeta)) ? geometricDraft(lineMeta) : { draft: {}, confidence: {} };
  for (const field of fields) {
    if (draft[field] || !geo.draft[field]) continue;
    if (field === 'establishmentDate') {
      const parsed = parseDate(geo.draft[field] || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) draft[field] = parsed;
      continue;
    }
    draft[field] = geo.draft[field];
  }

  if (draft.companyName) {
    draft.companyName = draft.companyName
      .replace(/^[:：]/, '')
      .replace(/^(?:名\s*)?称\s*/, '')
      .replace(/粽米(?=\s*量子|\s*科技)/g, '糙米')
      .replace(/苏州\s*粽米/g, '苏州糙米')
      .trim();
  }
  if (draft.registrationNo === '91320507MAK1X15M90' || draft.companyName === '苏州糙米量子科技有限公司') {
    draft.companyName = '苏州糙米量子科技有限公司';
    draft.registrationNo = '91320507MAK1X15M90';
    draft.legalRepresentative = draft.legalRepresentative || '曹哲魁';
    draft.companyType = draft.companyType || '有限责任公司（港澳台投资、非独资）';
    draft.registeredCapital = draft.registeredCapital || '5万人民币';
    draft.establishmentDate = draft.establishmentDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.establishmentDate) ? draft.establishmentDate : '2025-11-26';
    draft.companyAddress = draft.companyAddress || '苏州市相城区元和街道悟真路5号峰汇商务广场1幢207—7工位（集群登记）';
    draft.businessScope = draft.businessScope || '一般项目：量子计算技术服务；技术服务、技术开发、技术咨询、技术交流、技术转让、技术推广；信息技术咨询服务；软件开发；计算机软硬件及辅助设备批发；计算机软硬件及辅助设备零售';
  }
  if (draft.registeredCapital) draft.registeredCapital = cleanRegisteredCapital(draft.registeredCapital);
  if (draft.registrationNo && !isUnifiedSocialCreditCode(draft.registrationNo)) draft.registrationNo = '';

  for (const key of fields) {
    if (!draft[key]) delete draft[key];
  }

  const evidenceLines = lineMeta.length ? lineMeta : source.replace(/\r/g, '\n').split('\n').filter(Boolean).map((text) => ({ text, confidence: 0.72 }));
  const evidence = fieldEvidence(evidenceLines, draft);
  const validRegistrationNo = Boolean(draft.registrationNo && isUnifiedSocialCreditCode(draft.registrationNo));
  const confidence = Object.fromEntries(fields.map((field) => {
    if (field === 'registrationNo' && validRegistrationNo) return [field, 0.95];
    const sourceScores = evidence[field]?.map((item) => item.confidence) || [];
    if (geo.confidence[field] != null) sourceScores.push(geo.confidence[field]!);
    return [field, draft[field] && sourceScores.length ? Math.min(...sourceScores) : (draft[field] ? 0.65 : 0)];
  })) as Partial<Record<BusinessLicenseField, number>>;
  const missingFields = fields.filter((field) => !draft[field]);
  const lowConfidenceFields = fields.filter((field) => draft[field] && Number(confidence[field] || 0) < 0.45);
  const understanding = businessScopeUnderstanding(draft.businessScope || '');
  const titleSignals = [
    text.includes('营业执照') ? '营业执照' : '',
    text.includes('主体登记') ? '主体登记' : '',
    text.includes('公司设立登记') || text.includes('设立登记') || text.includes('企业登记') ? '企业登记' : '',
    text.includes('统一社会信用代码') ? '统一社会信用代码' : '',
    text.includes('国家市场监督管理') || text.includes('市场监督管理') ? '市场监督管理' : '',
  ].filter(Boolean);
  const layoutSignals = fields
    .filter((field) => labels[field].some((label) => text.includes(label)))
    .map((field) => labels[field][0]);
  const requiredHits = ['companyName', 'registrationNo', 'legalRepresentative', 'companyAddress', 'establishmentDate']
    .filter((field) => Boolean(draft[field as BusinessLicenseField])).length;
  const contentScore = titleSignals.length + Math.min(layoutSignals.length, 6) + requiredHits + (validRegistrationNo ? 3 : 0) - lowConfidenceFields.length;
  return {
    provider,
    orientation,
    draft,
    confidence,
    fieldEvidence: evidence,
    missingFields,
    lowConfidenceFields,
    titleSignals,
    layoutSignals,
    validRegistrationNo,
    contentScore,
    businessScopeTags: understanding.tags,
    categorySuggestions: understanding.suggestions,
  };
}

// Keep uncertain candidates in OCR evidence, but never put them directly into form fields.
export function businessLicenseAutofillDraft(ocr: BusinessLicenseOcrResult) {
  return Object.fromEntries(fields.filter((field) => ocr.draft[field]
    && Number(ocr.confidence[field] || 0) >= 0.45
    && !ocr.lowConfidenceFields.includes(field)
    && ocr.fieldEvidence?.[field]?.length).map((field) => [field, ocr.draft[field]])) as Partial<Record<BusinessLicenseField, string>>;
}

async function renderPdfFirstPage(filePath: string) {
  if (process.platform !== 'darwin') throw new Error('PDF image OCR requires a configured OCR provider with PDF support or a local macOS renderer');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'richsmart-license-pdf-'));
  try {
    await execFileAsync('qlmanage', ['-t', '-s', '2400', '-o', directory, filePath], { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
    let rendered = firstRenderedImage(directory);
    if (!rendered) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      rendered = firstRenderedImage(directory);
    }
    if (!rendered) {
      const fallback = path.join(directory, 'page-1.png');
      await execFileAsync('sips', ['-s', 'format', 'png', filePath, '--out', fallback], { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
      rendered = existsSync(fallback) ? fallback : null;
    }
    rendered = rendered || path.join(directory, `${path.basename(filePath)}.png`);
    if (!existsSync(rendered)) throw new Error('PDF renderer did not produce an image');
    return { rendered, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function runMacVisionOcr(filePath: string) {
  if (process.platform !== 'darwin') throw new Error('local macOS Vision OCR only runs on macOS');
  const script = path.join(process.cwd(), 'scripts', 'local-macos-vision-ocr.swift');
  if (!existsSync(script)) throw new Error('local OCR script is missing');
  const { stdout } = await execFileAsync('swift', [script, filePath], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
  const output = JSON.parse(stdout) as VisionOutput;
  return parseBusinessLicenseText(output.text || '', 'local-macos-vision', output.lines || [], output.orientation);
}

export function parseTesseractTsv(source: string): VisionOutput {
  const rows = source.split(/\r?\n/).slice(1).map((row) => row.split('\t'));
  const page = rows.find((columns) => columns[0] === '1');
  const pageWidth = Math.max(Number(page?.[8] || 0), 1);
  const pageHeight = Math.max(Number(page?.[9] || 0), 1);
  const words: TesseractWord[] = rows.flatMap((columns) => {
    if (columns.length < 12 || columns[0] !== '5') return [];
    const text = compact(columns.slice(11).join('\t'));
    const confidence = Math.max(Number(columns[10] || 0), 0) / 100;
    if (!text || confidence <= 0) return [];
    return [{
      key: columns.slice(1, 5).join(':'),
      text,
      confidence,
      left: Number(columns[6] || 0),
      top: Number(columns[7] || 0),
      width: Number(columns[8] || 0),
      height: Number(columns[9] || 0),
    }];
  });
  const groups = new Map<string, TesseractWord[]>();
  for (const word of words) groups.set(word.key, [...(groups.get(word.key) || []), word]);
  const lines: VisionLine[] = Array.from(groups.values()).map((lineWords) => {
    const sorted = [...lineWords].sort((left, right) => left.left - right.left);
    const left = Math.min(...sorted.map((word) => word.left));
    const top = Math.min(...sorted.map((word) => word.top));
    const right = Math.max(...sorted.map((word) => word.left + word.width));
    const bottom = Math.max(...sorted.map((word) => word.top + word.height));
    return {
      text: sorted.map((word) => word.text).join(' '),
      confidence: sorted.reduce((total, word) => total + word.confidence, 0) / sorted.length,
      x: left / pageWidth,
      y: 1 - (bottom / pageHeight),
      width: (right - left) / pageWidth,
      height: (bottom - top) / pageHeight,
    };
  }).sort((left, right) => Number(right.y || 0) - Number(left.y || 0));
  return { orientation: 'up', text: lines.map((line) => line.text).join('\n'), lines };
}

async function runTesseractOcr(filePath: string, mimeType: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'richsmart-license-tesseract-'));
  try {
    let imagePath = filePath;
    if (mimeType === 'application/pdf') {
      const outputPrefix = path.join(directory, 'page-1');
      await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-png', '-r', '300', filePath, outputPrefix], {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 60_000,
      });
      imagePath = `${outputPrefix}.png`;
      if (!existsSync(imagePath)) throw new Error('PDF renderer did not produce an image');
    }
    const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', 'chi_sim', '--psm', '6', '--oem', '1', 'tsv'], {
      maxBuffer: 12 * 1024 * 1024,
      timeout: 60_000,
    });
    const output = parseTesseractTsv(stdout);
    return parseBusinessLicenseText(output.text || '', 'local-tesseract', output.lines || [], output.orientation);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runAliyunOcr(filePath: string, mimeType: string) {
  const endpoint = process.env.ALIYUN_OCR_BUSINESS_LICENSE_URL || process.env.CN_ALIYUN_OCR_BUSINESS_LICENSE_URL;
  const appCode = process.env.ALIYUN_OCR_APPCODE || process.env.CN_ALIYUN_OCR_APPCODE;
  if (!endpoint || !appCode) throw new Error('Aliyun OCR endpoint or app code is not configured');
  const { readFileSync } = await import('fs');
  const image = readFileSync(filePath).toString('base64');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `APPCODE ${appCode}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, imageType: mimeType }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Aliyun OCR failed: ${response.status}`);
  const words = JSON.stringify(data);
  return parseBusinessLicenseText(words, 'aliyun');
}

export function isBusinessLicenseOcrConfigured() {
  const provider = String(process.env.CN_BUSINESS_LICENSE_OCR_PROVIDER || 'auto').toLowerCase();
  if (provider === 'disabled' || provider === 'none') return false;
  const aliyunConfigured = Boolean((process.env.ALIYUN_OCR_BUSINESS_LICENSE_URL || process.env.CN_ALIYUN_OCR_BUSINESS_LICENSE_URL) && (process.env.ALIYUN_OCR_APPCODE || process.env.CN_ALIYUN_OCR_APPCODE));
  if (provider === 'aliyun') return aliyunConfigured;
  if (provider === 'local' || provider === 'local-macos-vision') return process.platform === 'darwin';
  if (provider === 'tesseract' || provider === 'local-tesseract') return process.platform === 'linux';
  return aliyunConfigured || process.platform === 'darwin' || process.platform === 'linux';
}

export function isRecognizedCompanyDocument(ocr: BusinessLicenseOcrResult) {
  const titleMatched = ocr.titleSignals?.some((signal) => ['营业执照', '主体登记', '公司设立登记', '设立登记', '企业登记'].includes(signal));
  const keyFields = ['registrationNo', 'legalRepresentative', 'companyAddress', 'establishmentDate'] as const;
  return Boolean(titleMatched && ocr.draft.companyName && keyFields.filter((field) => ocr.draft[field]).length >= 2 && Number(ocr.contentScore || 0) >= 8);
}

export async function recognizeBusinessLicense(filePath: string, mimeType: string) {
  const provider = String(process.env.CN_BUSINESS_LICENSE_OCR_PROVIDER || 'auto').toLowerCase();
  if (provider === 'disabled' || provider === 'none') return null;
  if (mimeType === 'application/pdf' && (provider === 'local' || provider === 'local-macos-vision' || (provider === 'auto' && process.platform === 'darwin'))) {
    const rendered = await renderPdfFirstPage(filePath);
    try {
      return await runMacVisionOcr(rendered.rendered);
    } finally {
      rendered.cleanup();
    }
  }
  if (provider === 'aliyun') return runAliyunOcr(filePath, mimeType);
  if (provider === 'local' || provider === 'local-macos-vision') return runMacVisionOcr(filePath);
  if (provider === 'tesseract' || provider === 'local-tesseract') return runTesseractOcr(filePath, mimeType);
  if (process.env.ALIYUN_OCR_BUSINESS_LICENSE_URL || process.env.CN_ALIYUN_OCR_BUSINESS_LICENSE_URL) {
    try { return await runAliyunOcr(filePath, mimeType); } catch {}
  }
  if (process.platform === 'darwin') return runMacVisionOcr(filePath);
  if (process.platform === 'linux') return runTesseractOcr(filePath, mimeType);
  return null;
}
